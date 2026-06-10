import { maskTrainingData } from '@/lib/safety/mask-training-data';
import {
  checkSellerMessageSafety,
  detectSellerRiskFlags,
  extractKrwPrice,
  policyWarningText,
} from '@/lib/safety/seller-safety-rules';

export function detectPolicyFlags(text: string): string[] {
  return detectSellerRiskFlags(text).map((flag) => flag === 'private_info_request' ? 'private_info' : flag);
}

export function isUserConfirmationRequired(message: string): { required: boolean; reason?: string; offerPrice?: number } {
  const decision = checkSellerMessageSafety(message);
  return {
    required: decision.requiresUserConfirmation,
    reason: decision.reason,
    offerPrice: decision.detectedOfferPrice,
  };
}

export function stripPrivateInfo(text: string): string {
  return maskTrainingData(text);
}

export { extractKrwPrice, policyWarningText };
