// 클린 AI 라운지 전용 엔진 카탈로그.
// 바이너리/PV·BV 보상 상품(aiLoungeLedger)과 의도적으로 분리하여, 순수 GAS 소비형 상품의
// 단가/라벨이 다단계 장부 카탈로그에 종속되지 않도록 한다.
// (docs/WORLD_CLASS_VERIFICATION.md — /clean-lounge 는 바이너리/PV 를 생성하지 않는다.)
//
// 단가(gasCost)는 /clean-lounge 화면 버튼에 표시되는 GAS 와 1:1 로 일치해야 한다.
// (표시가 == 실제 차감가 — 정직한 영수증 불변식)

export type CleanEngineKey =
  | 'b200-beauty-lora'
  | 'gpt4o-premium'
  | 'gemini-2-ultra'
  | 'gemini-2-pro';

export type CleanEngineProfile = {
  key: CleanEngineKey;
  label: string;
  gasCost: number;
  maxTokens: number;
};

// 2026 최신 프론티어 라인업. 구버전 저사양(1.5 Flash 등) 레거시는 포함하지 않는다.
export const CLEAN_LOUNGE_ENGINE_PROFILES: Record<CleanEngineKey, CleanEngineProfile> = {
  'b200-beauty-lora': {
    key: 'b200-beauty-lora',
    label: 'EdenClaw B200 Beauty LoRA (Gemma 27B)',
    gasCost: 25_000,
    maxTokens: 1_800,
  },
  'gpt4o-premium': {
    key: 'gpt4o-premium',
    label: 'GPT-4o Premium',
    gasCost: 20_000,
    maxTokens: 1_600,
  },
  'gemini-2-ultra': {
    key: 'gemini-2-ultra',
    label: 'Gemini 2.0 Ultra',
    gasCost: 15_000,
    maxTokens: 1_400,
  },
  'gemini-2-pro': {
    key: 'gemini-2-pro',
    label: 'Gemini 2.0 Pro',
    gasCost: 5_000,
    maxTokens: 1_200,
  },
};

// 화면 노출 순서: 최상위 → 프리미엄 → 기본형.
export const CLEAN_LOUNGE_ENGINE_ORDER: CleanEngineKey[] = [
  'b200-beauty-lora',
  'gpt4o-premium',
  'gemini-2-ultra',
  'gemini-2-pro',
];

// 알 수 없는 입력은 가장 저렴한 기본형으로 폴백한다(예측 가능한 최소 과금).
export const DEFAULT_CLEAN_ENGINE: CleanEngineKey = 'gemini-2-pro';

export function isCleanEngineKey(value: unknown): value is CleanEngineKey {
  return typeof value === 'string' && value in CLEAN_LOUNGE_ENGINE_PROFILES;
}

export function normalizeCleanEngine(input: unknown): CleanEngineKey {
  const key = typeof input === 'string' ? input.trim().toLowerCase().replace(/_/g, '-') : '';
  if (isCleanEngineKey(key)) return key;
  if (key.includes('b200') || key.includes('beauty') || key.includes('gemma') || key.includes('lora')) {
    return 'b200-beauty-lora';
  }
  if (key.includes('gpt') || key.includes('openai') || key.includes('4o')) return 'gpt4o-premium';
  if (key.includes('ultra')) return 'gemini-2-ultra';
  return DEFAULT_CLEAN_ENGINE;
}
