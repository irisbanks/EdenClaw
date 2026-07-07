// 원장 직렬화 통화 격리 가드.
//
// 하나의 transaction.amount 컬럼이 여러 통화를 담는다:
//  - BONUS_MATCHING : EP(수당) 금액
//  - TOKEN_PURCHASE : 원화(KRW) 결제 금액 (외부 프리미엄 패키지 등)
//
// UI/직렬화 단계에서 이를 한 필드로 섞으면 원화 결제액이 EP/USD 수당 흐름이나 GAS 원장에
// 합산된 것처럼 보여 회계가 오염된다. 여기서 통화별로 명시 분리하여,
// 원화 결제 금액이 EP/USD amount 흐름에 절대 가산되지 않도록 보장한다.
// (docs/WORLD_CLASS_VERIFICATION.md — 클린/바이너리/원화 매출 회계 경계 유지)

// 원화(KRW) 결제로 분류되는 트랜잭션 유형.
const KRW_PAYMENT_TX_TYPES = new Set<string>(['TOKEN_PURCHASE']);

export type RawLedgerTransaction = {
  id: string;
  txType: string;
  amount: number;
  pvGenerated: number;
  bvGenerated: number;
  createdAt: Date | string;
};

export type SerializedLedgerTransaction = {
  id: string;
  txType: string;
  currency: 'KRW' | 'EP';
  amount: number; // EP(수당)/USD 원장 가산 흐름 — 원화 결제액은 포함하지 않는다.
  krwAmount: number; // 독립된 원화 매출 필드 — KRW 결제 트랜잭션만 값을 가진다.
  pvGenerated: number;
  bvGenerated: number;
  createdAt: Date | string;
};

export function isKrwPaymentTx(txType: string): boolean {
  return KRW_PAYMENT_TX_TYPES.has(txType);
}

/** 트랜잭션을 통화 격리된 형태로 직렬화한다(원화 결제액과 EP/GAS 원장 분리). */
export function serializeLedgerTransaction(t: RawLedgerTransaction): SerializedLedgerTransaction {
  const isKrw = isKrwPaymentTx(t.txType);
  const amount = Number.isFinite(t.amount) ? t.amount : 0;
  return {
    id: t.id,
    txType: t.txType,
    currency: isKrw ? 'KRW' : 'EP',
    // 원화 결제는 EP/USD amount 흐름을 0 으로 격리하고, 금액은 krwAmount 로만 직렬화한다.
    amount: isKrw ? 0 : amount,
    krwAmount: isKrw ? amount : 0,
    pvGenerated: Number.isFinite(t.pvGenerated) ? t.pvGenerated : 0,
    bvGenerated: Number.isFinite(t.bvGenerated) ? t.bvGenerated : 0,
    createdAt: t.createdAt,
  };
}
