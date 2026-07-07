import { Decimal } from 'decimal.js';
import { prisma } from '@/lib/prisma';

// 과지급 방지: 정밀도 20, 항상 내림(ROUND_DOWN) → 절대 올림으로 더 지급하지 않음
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const MATCHING_RATE = new Decimal(0.1); // 소실적(약한 다리)의 10% 지급
const PER_CALL_CAP = new Decimal(1000.0); // [Shield] 1회 정산 단건 상한
const DAILY_CAP = new Decimal(1000.0); // [Shield] 유저당 1일 누적 수당 상한
// [Dual-Shield BV Cap] 수당은 매칭된 비즈니스 볼륨(실매출 마진) 이내로만 지급.
// 1.0 = 매칭 BV 전액까지 허용. 낮출수록 과지급 방어가 더 강해진다.
const BV_PAYOUT_CAP_RATE = new Decimal(1.0);

export class DualShieldMLMEngine {
  /**
   * 특정 유저의 LegBalance 원장을 읽어 바이너리 매칭 수당을 정산한다.
   *
   * - 약한 다리(소실적) 기준으로 매칭하고, 매칭된 BV(실매출 마진)를 한도로 과지급을 차단한다.
   * - 캡(BV/단건/일일)으로 수당이 깎이면 "실제 지급한 비율만큼만" 볼륨을 소진하여
   *   미지급분은 원장에 남아 다음 정산으로 자동 이월(carry-forward)된다.
   *
   * 결제 PV/BV 의 상위 라인 전파는 webhook 의 propagateVolumeUpline 이 담당하며,
   * 이 함수는 전파로 갱신된 원장을 기준으로 동작한다.
  */
  public static async settleMatchingBonus(userId: string): Promise<void> {
    try {
      const settled = await prisma.$transaction(async (tx) => {
        // PostgreSQL 세션이 몇 대로 늘어나도 같은 유저의 정산은 반드시 직렬화한다.
        // 트랜잭션 범위 advisory lock 이므로 성공/실패와 관계없이 자동 해제된다.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))::text AS lock_result`;

        const user = await tx.user.findUnique({
          where: { id: userId },
          include: { legBalance: true },
        });
        if (!user || user.subscriptionStatus !== 'ACTIVE' || !user.legBalance) return null;

        const leftPV = new Decimal(user.legBalance.leftPV);
        const rightPV = new Decimal(user.legBalance.rightPV);
        const leftBV = new Decimal(user.legBalance.leftBV);
        const rightBV = new Decimal(user.legBalance.rightBV);
        const balances = [leftPV, rightPV, leftBV, rightBV];
        if (balances.some((value) => !value.isFinite() || value.isNegative())) {
          throw new Error(`유저 ${userId}의 바이너리 원장에 유효하지 않은 값이 있습니다.`);
        }

        // 양쪽 다리에 실적이 있어야 매칭 발생
        const matchedPV = Decimal.min(leftPV, rightPV);
        if (matchedPV.lessThanOrEqualTo(0)) return null;

        // 매칭을 뒷받침하는 비즈니스 볼륨 = 양쪽 BV 중 작은 값 (보수적)
        const matchedBV = Decimal.min(leftBV, rightBV);

        // 1) 본래 발생 수당
        const earnedBonus = matchedPV.times(MATCHING_RATE);
        let bonus = earnedBonus;

        // 2) [Dual-Shield BV Cap] 매칭 BV(실매출 마진)를 넘는 수당 차단
        const bvCap = matchedBV.times(BV_PAYOUT_CAP_RATE);
        if (bonus.greaterThan(bvCap)) bonus = bvCap;

        // 3) [Shield] 단건 상한
        if (bonus.greaterThan(PER_CALL_CAP)) bonus = PER_CALL_CAP;

        // 4) [Shield] UTC 일일 누적 상한. advisory lock 안에서 조회/기록해 동시 초과 지급을 막는다.
        const now = new Date();
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const todayAgg = await tx.transaction.aggregate({
          where: { userId, txType: 'BONUS_MATCHING', createdAt: { gte: startOfDay } },
          _sum: { amount: true },
        });
        const paidToday = new Decimal(todayAgg._sum.amount ?? 0);
        const remainingDailyAllowance = DAILY_CAP.minus(paidToday);
        if (remainingDailyAllowance.lessThanOrEqualTo(0)) return null;
        if (bonus.greaterThan(remainingDailyAllowance)) bonus = remainingDailyAllowance;
        if (bonus.lessThanOrEqualTo(0)) return null;

        // 5) 실제 지급한 비율만큼만 볼륨 소진 → 미지급분은 이월
        const paidFraction = bonus.dividedBy(earnedBonus);
        const consumedPV = matchedPV.times(paidFraction);
        // 지급액을 실제로 담보한 매칭 BV를 양쪽에서 동일하게 소진한다.
        // PV 비율만으로 BV를 소진하면 BV cap으로 깎인 원장을 반복 정산해 과지급할 수 있다.
        const matchedBVConsumed = Decimal.min(matchedBV, bonus.dividedBy(BV_PAYOUT_CAP_RATE));
        const leftBVConsumed = Decimal.min(leftBV, matchedBVConsumed);
        const rightBVConsumed = Decimal.min(rightBV, matchedBVConsumed);

        // 1. 상위 유저 지갑에 현금성 포인트(EP) 즉시 가산
        await tx.user.update({
          where: { id: userId },
          data: { epBalance: { increment: bonus.toNumber() } },
        });

        // 2. 원장에서 매칭·소진된 볼륨 차감 (잔여분 = 이월)
        await tx.legBalance.update({
          where: { userId },
          data: {
            // SET 대신 원자 decrement 를 사용해 동시에 들어온 신규 실적 increment 를 보존한다.
            leftPV: { decrement: consumedPV.toNumber() },
            rightPV: { decrement: consumedPV.toNumber() },
            leftBV: { decrement: leftBVConsumed.toNumber() },
            rightBV: { decrement: rightBVConsumed.toNumber() },
          },
        });

        // 3. 투명한 수당 정산 로그 작성 (소진 PV 를 pvGenerated, 매칭 BV 를 bvGenerated 로 기록)
        await tx.transaction.create({
          data: {
            userId,
            txType: 'BONUS_MATCHING',
            amount: bonus.toNumber(),
            pvGenerated: consumedPV.toNumber(),
            bvGenerated: matchedBVConsumed.toNumber(),
          },
        });

        return {
          bonus: bonus.toString(),
          matchedPV: matchedPV.toString(),
          bvCap: bvCap.toString(),
        };
      }, { maxWait: 10_000, timeout: 30_000 });

      if (settled) {
        console.log(
          `[Dual-Shield] 유저 ${userId} 수당 정산 완료: +${settled.bonus} EP ` +
            `(matchedPV=${settled.matchedPV}, bvCap=${settled.bvCap}, carry-forward 적용)`
        );
      }
    } catch (error) {
      console.error('바이너리 수당 연산 중 치명적 오류 발생:', error);
      throw error;
    }
  }
}
