import { analyzeProductImage } from '@/lib/vision/analyze-product-image';
import { ProductAnalysis, ProductImageInput } from './types';

export async function runProductIntakeAgent(params: {
  images: ProductImageInput[];
  userHint?: string;
}): Promise<ProductAnalysis> {
  return analyzeProductImage(params.images, params.userHint || '');
}
