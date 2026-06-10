import { detectPolicyFlags } from '@/lib/agents/safety';

export interface PrivateInfoDetection {
  flags: string[];
  confidence: number;
  redactionRequired: boolean;
}

export async function detectPrivateInfo(input: { imageUrl?: string; ocrText?: string }): Promise<PrivateInfoDetection> {
  const flags = detectPolicyFlags(`${input.imageUrl || ''} ${input.ocrText || ''}`).filter((f) => f === 'private_info');
  return {
    flags,
    confidence: flags.length ? 0.72 : 0.12,
    redactionRequired: flags.length > 0,
  };
}
