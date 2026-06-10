import { GoogleGenerativeAI, Part } from '@google/generative-ai';

export interface PhotoAnalysisInput {
  base64?: string;
  mimeType?: string;
  url?: string;
  hint?: string;
}

export interface PhotoAnalysisResult {
  category: string;
  brand: string;
  color: string;
  condition: string;
  conditionScore: number;
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number;
  description: string;
  tags: string[];
  needsMorePhotos: boolean;
  suggestedAngles: string[];
  confidence: number;
}

const DEFAULT_RESULT: PhotoAnalysisResult = {
  category: '기타',
  brand: '브랜드 미상',
  color: '확인 불가',
  condition: '상태 확인 필요',
  conditionScore: 50,
  suggestedPrice: 0,
  minPrice: 0,
  maxPrice: 0,
  description: '상품 사진을 분석 중입니다.',
  tags: [],
  needsMorePhotos: true,
  suggestedAngles: ['정면', '뒷면', '측면', '하자 부위'],
  confidence: 0.3,
};

export async function analyzePhoto(inputs: PhotoAnalysisInput[]): Promise<PhotoAnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ...DEFAULT_RESULT, description: 'GEMINI_API_KEY 미설정 — 기본값 반환' };

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const parts: Part[] = [];

  for (const input of inputs) {
    if (input.base64 && input.mimeType) {
      parts.push({ inlineData: { data: input.base64, mimeType: input.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' } });
    } else if (input.url) {
      parts.push({ text: `이미지 URL: ${input.url}` });
    }
  }

  const hint = inputs.find((i) => i.hint)?.hint || '';
  parts.push({
    text: `다음 상품 사진을 분석해 JSON만 반환하라. 마크다운 블록 없이 순수 JSON.
사용자 힌트: ${hint || '없음'}

반환 형식 (모든 필드 필수):
{
  "category": "카테고리명(예:전자제품/의류/가구/도서/잡화/스포츠/뷰티/기타)",
  "brand": "브랜드명 또는 '브랜드 미상'",
  "color": "주요 색상",
  "condition": "새상품/거의새것/상태양호/보통/하자있음",
  "conditionScore": 0~100,
  "suggestedPrice": 원화 정수 권장가,
  "minPrice": 원화 정수 최저가,
  "maxPrice": 원화 정수 최고가,
  "description": "100자 이내 자연스러운 판매글 설명",
  "tags": ["태그1","태그2","태그3"],
  "needsMorePhotos": true/false,
  "suggestedAngles": ["추가 필요 각도 목록"],
  "confidence": 0.0~1.0
}`,
  });

  try {
    const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
    const text = result.response.text().trim();
    const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(clean) as Partial<PhotoAnalysisResult>;

    return {
      category: String(parsed.category || DEFAULT_RESULT.category),
      brand: String(parsed.brand || DEFAULT_RESULT.brand),
      color: String(parsed.color || DEFAULT_RESULT.color),
      condition: String(parsed.condition || DEFAULT_RESULT.condition),
      conditionScore: Number(parsed.conditionScore ?? DEFAULT_RESULT.conditionScore),
      suggestedPrice: Number(parsed.suggestedPrice ?? 0),
      minPrice: Number(parsed.minPrice ?? 0),
      maxPrice: Number(parsed.maxPrice ?? 0),
      description: String(parsed.description || DEFAULT_RESULT.description),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      needsMorePhotos: Boolean(parsed.needsMorePhotos ?? true),
      suggestedAngles: Array.isArray(parsed.suggestedAngles) ? parsed.suggestedAngles.map(String) : DEFAULT_RESULT.suggestedAngles,
      confidence: Number(parsed.confidence ?? DEFAULT_RESULT.confidence),
    };
  } catch {
    return DEFAULT_RESULT;
  }
}
