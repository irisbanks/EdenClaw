export interface SimilarItem {
  id: string;
  title: string;
  price: number;
  category: string;
  condition?: string;
  url?: string;
}

export interface TradeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TradeContext {
  userId?: string;
  itemPhoto?: string;
  itemDescription?: string;
  userPrice?: number;
  intent: TradeIntent;
  history?: TradeMessage[];
  sourceUrl?: string;
  sourcePlatform?: GlobalPurchasePlatform;
  preparePurchase?: boolean;
  purchaseAction?: 'add_to_cart' | 'buy_now';
  dryRun?: boolean;
}

export type TradeIntent =
  | 'analyze_item'
  | 'set_price'
  | 'negotiate'
  | 'write_listing'
  | 'prepare_purchase'
  | 'check_safety'
  | 'general_chat';

export interface AnalysisResult {
  category: string;
  brand?: string;
  condition: 'S' | 'A' | 'B' | 'C';
  suggested_price: number;
  price_range: { min: number; max: number; avg: number };
  confidence: number;
  reasoning: string;
  similar_items?: SimilarItem[];
}

export interface ConcessionPoint {
  day: number;
  price: number;
}

export interface NegotiationStrategy {
  list_price: number;
  floor_price: number;
  fair_price?: number;
  price_confidence?: number;
  expected_days: number;
  success_rate: number;
  concession_curve: ConcessionPoint[];
  reasoning: string;
}

export interface ListingDraft {
  platform: 'daangn';
  title: string;
  content: string;
  price: number;
  tags: string[];
  display_metadata: {
    confidence_score: number;
    price_reasoning: string;
  };
}

export type GlobalPurchasePlatform = 'aliexpress' | 'amazon';

export type GlobalPurchaseStatus =
  | 'unsupported_platform'
  | 'selector_ready'
  | 'cart_ready'
  | 'login_required'
  | 'payment_guard'
  | 'blocked'
  | 'error';

export interface GlobalPurchasePreparation {
  status: GlobalPurchaseStatus;
  platform: GlobalPurchasePlatform | 'unknown';
  url: string;
  action: 'add_to_cart' | 'buy_now';
  dry_run: boolean;
  product_title?: string;
  selector_used?: string;
  checkout_guard_selectors: string[];
  session_dir?: string;
  storage_state_path?: string;
  message: string;
  warnings: string[];
}

export interface TradeResponse {
  message: string;
  intent_detected: TradeIntent;
  analysis?: AnalysisResult;
  strategy?: NegotiationStrategy;
  listing?: ListingDraft;
  global_purchase?: GlobalPurchasePreparation;
  warnings?: string[];
  reasoning_steps: string[];
  tools_used: string[];
}
