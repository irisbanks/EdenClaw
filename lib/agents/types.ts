export const DRAFT_STATUSES = [
  'PHOTO_CAPTURED',
  'AI_ANALYZING',
  'ASK_PRICE',
  'ASK_MORE_PHOTOS',
  'DRAFT_CREATED',
  'PREVIEW_APPROVED',
  'LISTED',
  'SELLER_AGENT_ACTIVE',
  'OFFER_RECEIVED',
  'USER_CONFIRM_REQUIRED',
  'RESERVED',
  'SOLD',
  'PAUSED',
  'DELETED',
  'REJECTED_BY_POLICY',
] as const;

export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export interface ProductImageInput {
  id?: string;
  url: string;
  storagePath?: string;
  mimeType?: string;
}

export interface ProductAnalysis {
  productName: string;
  category: string;
  condition: string;
  confidence: number;
  needsMorePhotos: boolean;
  suggestedAngles: string[];
  riskFlags: string[];
  privateInfoFlags: string[];
  prohibited: boolean;
  notes: string;
}

export interface PriceSuggestion {
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number;
  currency: string;
  rationale: string;
  requiresUserPrice: boolean;
}

export interface ListingDraftResult {
  title: string;
  description: string;
  tags: string[];
  tradeMethod: string;
  policyWarnings: string[];
}

export interface PreviewCard {
  headline: string;
  subheadline: string;
  priceLabel: string;
  badge: string;
  imageUrl?: string;
  trustNotes: string[];
  ctaLabel: string;
  layout: 'mobile-card';
}

export interface SellerAgentResponse {
  reply: string;
  status: 'OK' | 'USER_CONFIRM_REQUIRED' | 'REJECTED_BY_POLICY';
  requiresUserConfirmation: boolean;
  confirmationReason?: string;
  detectedOfferPrice?: number;
  riskFlags: string[];
}
