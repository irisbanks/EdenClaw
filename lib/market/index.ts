// lib/market - AI Market v2 엔진 진입점
export { createNegotiationStream } from './negotiation-engine';
export type { NegotiationOptions, NegotiationEvent, NegotiationTurn } from './negotiation-engine';

export { verifyProduct } from './verification-engine';
export type { VerificationResult, VerificationScores } from './verification-engine';

export { recommend } from './recommendation-engine';
export type { RecommendationOptions, RecommendedProduct } from './recommendation-engine';

export { voiceShop, transcribeAudio, parseShoppingIntent } from './voice-shop-engine';
export type { VoiceShopResult, ParsedShoppingIntent } from './voice-shop-engine';

export { smartMatch } from './smart-match-engine';
export type { MatchOptions, MatchResult } from './smart-match-engine';

export { calculateReputation, getReputation } from './reputation-engine';
export type { ReputationResult } from './reputation-engine';

export { analyzePriceTrend, recordPrice } from './price-trend-engine';
export type { PriceTrendResult } from './price-trend-engine';
