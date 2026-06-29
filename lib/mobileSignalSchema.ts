// Schema + validation for the public mobile manual-order signal.
// This is a DISPLAY signal only. It never carries exchange keys and never
// instructs the browser to place an order. The browser only reads it.

export const TICKET_STATUSES = ['READY', 'WAIT', 'BLOCKED', 'EXPIRED'] as const;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export const SIDES = ['LONG', 'SHORT', 'NONE'] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Side = (typeof SIDES)[number];

export interface MobileOrderSignal {
  source: string;
  timestamp: string;
  ticket_status: TicketStatus;
  priority: Priority;
  exchange: string;
  symbol: string;
  market_type: string;
  candidate: string;
  side: Side;
  recommended_margin_usdt: number;
  max_margin_usdt: number;
  leverage: number;
  reference_price: number | null;
  suggested_limit_price: number | null;
  take_profit_price: number | null;
  stop_loss_price: number | null;
  risk_reward: number;
  reason: string;
  blocked_reasons: string[];
  expires_at: string;
  bot_order_execution: 'DISABLED';
  real_order_sent_by_bot: false;
  user_must_place_order_manually: true;
  // server-stamped
  received_at?: string;
}

export interface NoSignalResponse {
  ticket_status: 'NO_SIGNAL';
  message: 'No mobile signal received yet';
  bot_order_execution: 'DISABLED';
  real_order_sent_by_bot: false;
  user_must_place_order_manually: true;
}

export const NO_SIGNAL_RESPONSE: NoSignalResponse = {
  ticket_status: 'NO_SIGNAL',
  message: 'No mobile signal received yet',
  bot_order_execution: 'DISABLED',
  real_order_sent_by_bot: false,
  user_must_place_order_manually: true,
};

function isNumOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

/**
 * Validate an incoming payload against the signal schema.
 * Returns the normalised signal or a list of human-readable errors.
 * SAFETY: hard-pins the no-auto-order invariants regardless of input.
 */
export function validateSignal(
  input: unknown,
): { ok: true; value: MobileOrderSignal } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['payload must be a JSON object'] };
  }
  const p = input as Record<string, unknown>;

  const reqStr = (k: string) => {
    if (typeof p[k] !== 'string') errors.push(`${k} must be a string`);
  };
  reqStr('source');
  reqStr('timestamp');
  reqStr('exchange');
  reqStr('symbol');
  reqStr('market_type');
  reqStr('candidate');
  reqStr('reason');
  reqStr('expires_at');

  if (!TICKET_STATUSES.includes(p.ticket_status as TicketStatus)) {
    errors.push(`ticket_status must be one of ${TICKET_STATUSES.join('|')}`);
  }
  if (p.priority !== undefined && !PRIORITIES.includes(p.priority as Priority)) {
    errors.push(`priority must be one of ${PRIORITIES.join('|')}`);
  }
  if (!SIDES.includes(p.side as Side)) {
    errors.push(`side must be one of ${SIDES.join('|')}`);
  }

  for (const k of ['recommended_margin_usdt', 'max_margin_usdt', 'leverage', 'risk_reward']) {
    if (typeof p[k] !== 'number' || !Number.isFinite(p[k] as number)) {
      errors.push(`${k} must be a finite number`);
    }
  }
  for (const k of ['reference_price', 'suggested_limit_price', 'take_profit_price', 'stop_loss_price']) {
    if (!isNumOrNull(p[k])) errors.push(`${k} must be a number or null`);
  }
  if (!Array.isArray(p.blocked_reasons) || !p.blocked_reasons.every((x) => typeof x === 'string')) {
    errors.push('blocked_reasons must be a string array');
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: MobileOrderSignal = {
    source: String(p.source),
    timestamp: String(p.timestamp),
    ticket_status: p.ticket_status as TicketStatus,
    priority: (p.priority as Priority) ?? 'NORMAL',
    exchange: String(p.exchange),
    symbol: String(p.symbol),
    market_type: String(p.market_type),
    candidate: String(p.candidate),
    side: p.side as Side,
    recommended_margin_usdt: p.recommended_margin_usdt as number,
    max_margin_usdt: p.max_margin_usdt as number,
    leverage: p.leverage as number,
    reference_price: p.reference_price as number | null,
    suggested_limit_price: p.suggested_limit_price as number | null,
    take_profit_price: p.take_profit_price as number | null,
    stop_loss_price: p.stop_loss_price as number | null,
    risk_reward: p.risk_reward as number,
    reason: String(p.reason),
    blocked_reasons: p.blocked_reasons as string[],
    expires_at: String(p.expires_at),
    // Invariants are HARD-PINNED here. A client cannot flip these on.
    bot_order_execution: 'DISABLED',
    real_order_sent_by_bot: false,
    user_must_place_order_manually: true,
    received_at: new Date().toISOString(),
  };
  return { ok: true, value };
}
