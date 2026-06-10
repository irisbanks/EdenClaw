export interface JsonResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
}

/**
 * fetch + JSON 파싱을 본문 1회 소비로 안전하게 처리.
 *
 * - response.clone() 을 쓰지 않는다(본문을 두 곳에서 읽지 않으므로 불필요).
 * - 본문은 .text() 로 정확히 한 번만 읽고 JSON.parse → "body already used" 류 double-consume 원천 차단.
 * - ok/status 를 함께 반환해 4xx(예: 402 LOCKED) 분기를 본문 재소비 없이 처리.
 */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<JsonResult<T>> {
  const res = await fetch(input, init);
  const raw = await res.text(); // 단 한 번만 소비
  let data: T | null = null;
  if (raw) {
    try {
      data = JSON.parse(raw) as T;
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data };
}
