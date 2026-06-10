import crypto from 'crypto';

export interface WebhookVerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * 결제 웹훅 서명 검증.
 *
 * 두 가지 모드를 지원한다 (PG/WooCommerce 연동 형태에 맞춰 사용):
 *  1) HMAC 모드 — `X-Webhook-Signature: sha256=<hex>` 헤더가 있으면
 *     `PAYMENT_WEBHOOK_SECRET` 으로 raw body 의 HMAC-SHA256 을 계산해 타이밍 세이프 비교.
 *  2) 공유 시크릿 모드 — `X-Webhook-Secret` 헤더를 시크릿과 직접 비교(타이밍 세이프).
 *
 * 반드시 "원본 raw body 문자열"을 넘겨야 한다(JSON.parse 후 재직렬화하면 서명 불일치).
 *
 * 보안 정책:
 *  - 프로덕션에서 시크릿 미설정 → fail-closed(거부).
 *  - 개발 환경에서 시크릿 미설정 → 경고 후 통과(로컬 테스트 편의).
 */
export function verifyWebhookSignature(rawBody: string, req: Request): WebhookVerifyResult {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: 'secret-not-configured' };
    }
    console.warn('[webhook-security] PAYMENT_WEBHOOK_SECRET 미설정 — 개발 환경이라 검증을 건너뜁니다.');
    return { ok: true, reason: 'dev-bypass' };
  }

  // 1) HMAC 서명 모드
  const sigHeader = req.headers.get('x-webhook-signature');
  if (sigHeader) {
    const provided = sigHeader.startsWith('sha256=') ? sigHeader.slice(7) : sigHeader;
    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    return { ok: timingSafeEqualHex(expected, provided), reason: 'hmac' };
  }

  // 2) 공유 시크릿 모드
  const shared = req.headers.get('x-webhook-secret');
  if (shared && timingSafeEqualUtf8(shared, secret)) {
    return { ok: true, reason: 'shared-secret' };
  }

  return { ok: false, reason: 'invalid-signature' };
}

/** 길이 노출/타이밍 공격 방지 hex 비교 */
function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** 타이밍 세이프 UTF-8 비교 (길이 다르면 즉시 false 지만 동일 길이 경로는 상수시간) */
function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
