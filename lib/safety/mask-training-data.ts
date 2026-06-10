export type MaskedType =
  | 'phone'
  | 'email'
  | 'address'
  | 'bank_account'
  | 'resident_id'
  | 'vehicle_plate';

export interface MaskTrainingDataResult {
  text: string;
  maskedTypes: MaskedType[];
  maskCount: number;
}

const MASK_PATTERNS: { type: MaskedType; pattern: RegExp }[] = [
  { type: 'email', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: 'phone', pattern: /\b(?:010|011|016|017|018|019)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g },
  { type: 'resident_id', pattern: /\b\d{6}[-\s]?[1-4]\d{6}\b/g },
  { type: 'bank_account', pattern: /\b\d{2,6}[-\s]\d{2,6}[-\s]\d{2,8}\b/g },
  { type: 'vehicle_plate', pattern: /\b\d{2,3}[가-힣]\s?\d{4}\b/g },
  {
    type: 'address',
    pattern: /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{0,30}(?:구|군|시)[^\n,]{0,40}(?:로|길|동|읍|면|아파트|빌라|오피스텔)[^\n,]*/g,
  },
];

export function maskTrainingData(input: unknown): string {
  return maskTrainingDataDetailed(typeof input === 'string' ? input : JSON.stringify(input ?? '')).text;
}

export function maskTrainingDataDetailed(input: string): MaskTrainingDataResult {
  let text = input;
  const maskedTypes: MaskedType[] = [];
  let maskCount = 0;

  for (const { type, pattern } of MASK_PATTERNS) {
    text = text.replace(pattern, () => {
      maskedTypes.push(type);
      maskCount += 1;
      return '[MASKED]';
    });
  }

  return {
    text,
    maskedTypes: [...new Set(maskedTypes)],
    maskCount,
  };
}

export function containsSensitiveInfo(input: string): boolean {
  return MASK_PATTERNS.some(({ pattern }) => pattern.test(input));
}
