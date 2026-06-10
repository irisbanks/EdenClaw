import { GoogleGenerativeAI } from '@google/generative-ai';
import * as tools from '../tools';
import { analyzePrice } from '../tools/price-analyzer';
import type { TradeContext, TradeResponse, TradeIntent, AnalysisResult } from '../types/trader';

export class ExpertTrader {
  private gemini: GoogleGenerativeAI;

  constructor() {
    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }

  async respond(context: TradeContext): Promise<TradeResponse> {
    const reasoning_steps: string[] = [];
    const tools_used: string[] = [];

    reasoning_steps.push('Detecting intent...');
    const intent = this.detectIntent(context);
    reasoning_steps.push(`Intent: ${intent}`);

    switch (intent) {
      case 'analyze_item':
        return this.analyzeItem(context, reasoning_steps, tools_used);
      case 'negotiate':
      case 'set_price':
        return this.negotiate(context, reasoning_steps, tools_used);
      case 'write_listing':
        return this.writeListing(context, reasoning_steps, tools_used);
      case 'prepare_purchase':
        return this.preparePurchase(context, reasoning_steps, tools_used);
      case 'check_safety':
        return this.checkSafety(context, reasoning_steps, tools_used);
      default:
        return this.generalChat(context, reasoning_steps, tools_used);
    }
  }

  private detectIntent(context: TradeContext): TradeIntent {
    if (context.intent && context.intent !== 'general_chat') return context.intent;
    if (context.sourceUrl) return 'prepare_purchase';
    if (context.itemPhoto) return 'analyze_item';
    if (context.userPrice) return 'negotiate';
    const desc = (context.itemDescription ?? '').toLowerCase();
    if (desc.includes('팔') || desc.includes('판매')) return 'write_listing';
    if (desc.includes('구매 준비') || desc.includes('장바구니')) return 'prepare_purchase';
    if (desc.includes('사기') || desc.includes('위험') || desc.includes('안전')) return 'check_safety';
    return 'general_chat';
  }

  private extractSourceUrl(context: TradeContext): string {
    if (context.sourceUrl) return context.sourceUrl;
    const match = (context.itemDescription ?? '').match(/https?:\/\/\S+/);
    return match?.[0] ?? '';
  }

  private async analyzeItem(
    context: TradeContext,
    reasoning: string[],
    tools_used: string[]
  ): Promise<TradeResponse> {
    reasoning.push('Starting photo analysis');
    tools_used.push('analyzePhoto');

    const photoInput = {
      base64: context.itemPhoto?.startsWith('data:')
        ? context.itemPhoto.split(',')[1]
        : undefined,
      url: context.itemPhoto?.startsWith('http') ? context.itemPhoto : undefined,
      hint: context.itemDescription,
    };
    const photoResult = await tools.analyzePhoto([photoInput]);
    reasoning.push(`Category: ${photoResult.category}, Brand: ${photoResult.brand}`);

    tools_used.push('search_market');
    const similar = await tools.search_market({
      category: photoResult.category,
      keywords: photoResult.brand !== '브랜드 미상' ? photoResult.brand : undefined,
    });
    reasoning.push(`Found ${similar.length} similar items`);

    // Phase 2: real price analysis (Naver + internal DB)
    reasoning.push('Price analysis: Naver + internal DB');
    tools_used.push('analyzePrice');

    const conditionMap: Record<string, 'S' | 'A' | 'B' | 'C'> = {
      '새상품': 'S', '거의새것': 'A', '상태양호': 'A', '보통': 'B', '하자있음': 'C',
    };
    const condition: 'S' | 'A' | 'B' | 'C' =
      conditionMap[photoResult.condition] ?? 'B';

    const priceAnalysis = await analyzePrice({
      query: photoResult.brand && photoResult.brand !== '브랜드 미상'
        ? `${photoResult.brand} ${photoResult.category}`
        : photoResult.category,
      category: photoResult.category,
      condition,
    });
    reasoning.push(...priceAnalysis.reasoning);

    const analysis: AnalysisResult = {
      category: photoResult.category,
      brand: photoResult.brand !== '브랜드 미상' ? photoResult.brand : undefined,
      condition,
      suggested_price: priceAnalysis.estimated_used_price || photoResult.suggestedPrice,
      price_range: {
        min: priceAnalysis.price_range.min || photoResult.minPrice,
        max: priceAnalysis.price_range.max || photoResult.maxPrice,
        avg: priceAnalysis.estimated_used_price || photoResult.suggestedPrice,
      },
      confidence: priceAnalysis.estimated_used_price > 0
        ? priceAnalysis.confidence
        : Math.max(priceAnalysis.confidence, photoResult.suggestedPrice > 0 ? Math.min(0.55, photoResult.confidence || 0.35) : 0),
      reasoning: priceAnalysis.reasoning.join(' → '),
      similar_items: similar.slice(0, 5),
    };

    const warnText = priceAnalysis.warnings.length > 0
      ? '\n' + priceAnalysis.warnings.map((w) => `⚠️  ${w}`).join('\n')
      : '';

    const amazonLine = priceAnalysis.amazon_count > 0
      ? `\n- 아마존 시세: $${priceAnalysis.amazon_min_usd} ~ $${priceAnalysis.amazon_avg_usd}` +
        ` (${priceAnalysis.amazon_min_krw.toLocaleString()} ~ ${priceAnalysis.amazon_avg_krw.toLocaleString()}원)`
      : '';

    const ma = priceAnalysis.margin_analysis;
    const marginLine = ma.recommendation !== 'insufficient_data'
      ? `\n\n💡 마진 추천: ${ma.reason}`
      : '';

    let global_purchase;
    if (context.preparePurchase && context.sourceUrl && ma.recommendation !== 'insufficient_data') {
      tools_used.push('global_buyer');
      reasoning.push('Preparing global sourcing purchase');
      global_purchase = await tools.prepareGlobalPurchase({
        productUrl: context.sourceUrl,
        platform: context.sourcePlatform,
        action: context.purchaseAction || 'add_to_cart',
        dryRun: context.dryRun ?? true,
        sessionId: context.userId || 'expert-trader',
      });
      reasoning.push(`Global purchase status: ${global_purchase.status}`);
    }

    const message =
      `📊 시세 분석 완료\n` +
      `- 카테고리: ${analysis.category}${analysis.brand ? ` (${analysis.brand})` : ''}\n` +
      `- 상태: ${photoResult.condition}\n` +
      `- 추천가: ${analysis.suggested_price.toLocaleString()}원\n` +
      `- 가격대: ${analysis.price_range.min.toLocaleString()} ~ ${analysis.price_range.max.toLocaleString()}원\n` +
      `- 신뢰도: ${(analysis.confidence * 100).toFixed(0)}%` +
      amazonLine +
      warnText +
      marginLine;

    return { message, intent_detected: 'analyze_item', analysis, global_purchase, reasoning_steps: reasoning, tools_used };
  }

  private async negotiate(
    context: TradeContext,
    reasoning: string[],
    tools_used: string[]
  ): Promise<TradeResponse> {
    const listPrice = context.userPrice!;
    reasoning.push(`List price: ${listPrice.toLocaleString()}원`);

    // 시세 + 아마존 + 마진 분석
    let fairPrice = listPrice;
    let priceContext = '';
    let marginContext = '';
    let priceConfidence = 0;

    if (context.itemDescription) {
      tools_used.push('analyzePrice');
      try {
        const priceAnalysis = await analyzePrice({ query: context.itemDescription });
        reasoning.push(...priceAnalysis.reasoning);
        priceConfidence = priceAnalysis.confidence;

        if (priceAnalysis.estimated_used_price > 0) {
          fairPrice = priceAnalysis.estimated_used_price;
          const diff = (((listPrice - fairPrice) / fairPrice) * 100).toFixed(1);
          const direction = listPrice > fairPrice ? '높음' : '낮음';
          priceContext =
            `\n- 시세: ${fairPrice.toLocaleString()}원 (네이버 ${priceAnalysis.naver_count}개 + DB ${priceAnalysis.swarm_count}개)\n` +
            `- 차이: ${diff}% ${direction}`;
        }

        if (priceAnalysis.amazon_count > 0) {
          priceContext +=
            `\n- 아마존: $${priceAnalysis.amazon_min_usd} ~ $${priceAnalysis.amazon_avg_usd}` +
            ` (${priceAnalysis.amazon_min_krw.toLocaleString()} ~ ${priceAnalysis.amazon_avg_krw.toLocaleString()}원)` +
            `\n- 관부가세 포함 직구가: ${priceAnalysis.margin_analysis.amazon_landed_krw.toLocaleString()}원`;
        }

        const ma = priceAnalysis.margin_analysis;
        if (ma.recommendation !== 'insufficient_data') {
          const icon =
            ma.recommendation === 'buy_amazon' ? '🛒' :
            ma.recommendation === 'sell_on_amazon' ? '📦' : '🏪';
          marginContext = `\n\n${icon} 마진 전략: ${ma.reason}`;

          if (ma.buy_amazon_sell_local > 0) {
            marginContext += `\n   아마존 직구 마진: +${ma.buy_amazon_sell_local.toLocaleString()}원`;
          }
          if (ma.buy_local_sell_amazon > 0) {
            marginContext += `\n   국내구매→아마존 마진: +${ma.buy_local_sell_amazon.toLocaleString()}원`;
          }
        }
      } catch {
        reasoning.push('Price analysis skipped');
      }
    }

    tools_used.push('simulate_negotiation');
    const sim = await tools.simulate_negotiation({
      list_price: listPrice,
      category: context.itemDescription ?? 'general',
      n_simulations: 100,
    });
    reasoning.push('Simulated 100 negotiations');

    const floorPrice = Math.round(Math.min(listPrice, fairPrice) * 0.85);
    const avgFinal = sim.final_prices.reduce((a, b) => a + b, 0) / sim.final_prices.length;

    const message =
      `💰 가격 분석 + 협상 전략\n` +
      `- 입력가: ${listPrice.toLocaleString()}원` +
      priceContext + '\n' +
      `- 최저 양보가: ${floorPrice.toLocaleString()}원\n` +
      `- 예상 거래 기간: ${sim.avg_days}일\n` +
      `- 협상 성공률: ${(sim.success_rate * 100).toFixed(0)}%\n` +
      `- 평균 최종 거래가: ${Math.round(avgFinal).toLocaleString()}원\n` +
      `\n💡 협상 추천: ${fairPrice.toLocaleString()}원 등록, ${Math.round(fairPrice * 0.95).toLocaleString()}원까지 양보` +
      marginContext;

    return {
      message,
      intent_detected: context.intent === 'set_price' ? 'set_price' : 'negotiate',
      strategy: {
        list_price: listPrice,
        floor_price: floorPrice,
        fair_price: fairPrice,
        price_confidence: priceConfidence,
        expected_days: sim.avg_days,
        success_rate: sim.success_rate,
        concession_curve: [
          { day: 0, price: listPrice },
          { day: Math.round(sim.avg_days / 2), price: Math.round((listPrice + floorPrice) / 2) },
          { day: sim.avg_days, price: floorPrice },
        ],
        reasoning: reasoning.join(' → '),
      },
      reasoning_steps: reasoning,
      tools_used,
    };
  }

  private async writeListing(
    context: TradeContext,
    reasoning: string[],
    tools_used: string[]
  ): Promise<TradeResponse> {
    let recommendedPrice = 0;
    let priceConfidence = 0;
    let priceSource = '시세 데이터 부족';
    const warnings: string[] = [];

    if (context.itemDescription) {
      tools_used.push('analyzePrice');
      try {
        const priceAnalysis = await analyzePrice({ query: context.itemDescription });
        reasoning.push(...priceAnalysis.reasoning);
        warnings.push(...priceAnalysis.warnings);

        if (priceAnalysis.estimated_used_price > 0) {
          recommendedPrice = priceAnalysis.estimated_used_price;
          priceConfidence = priceAnalysis.confidence;
          priceSource = `네이버 ${priceAnalysis.naver_count}개 + DB ${priceAnalysis.swarm_count}개`;
        }
      } catch {
        reasoning.push('Price analysis skipped');
      }
    }

    const finalPrice = context.userPrice ?? recommendedPrice;
    if (finalPrice > 0) {
      reasoning.push(`Listing price: ${finalPrice.toLocaleString()}원`);
    }

    const fairPrice = recommendedPrice || finalPrice;
    const floorPrice = fairPrice > 0
      ? Math.round(Math.min(finalPrice || fairPrice, fairPrice) * 0.85)
      : 0;
    const priceReason = (() => {
      if (fairPrice <= 0) return '시세 데이터가 부족해 판매자가 직접 가격을 확정해야 해요.';
      const diff = finalPrice > 0 ? (finalPrice - fairPrice) / fairPrice : 0;
      const floorText = floorPrice > 0
        ? ` 최저 양보가는 ${floorPrice.toLocaleString()}원 정도로 잡아두면 좋아요.`
        : '';
      if (diff <= -0.05) {
        return `최근 시세보다 ${Math.round(Math.abs(diff) * 100)}% 정도 저렴하게 내놓아요. 추천 판매가는 ${fairPrice.toLocaleString()}원입니다.${floorText}`;
      }
      if (diff <= 0.05) {
        return `최근 시세 기준 추천 판매가 ${fairPrice.toLocaleString()}원에 맞춰 합리적으로 내놓아요.${floorText}`;
      }
      return `최근 시세 기준 추천 판매가는 ${fairPrice.toLocaleString()}원이라서, 구성품과 상태 확인 후 네고 여지를 남겨두면 좋아요.${floorText}`;
    })();

    reasoning.push('Generating Karrot-optimized structured listing');
    tools_used.push('write_listing_karrot');

    const listing = await tools.writeKarrotListing({
      itemDescription: context.itemDescription ?? '상품',
      price: finalPrice,
      recommendedPrice: fairPrice,
      floorPrice,
      priceConfidence,
      priceReason,
      neighborhood: '[동네/역/아파트 단지명]',
    });

    const message = JSON.stringify(listing, null, 2);

    return {
      message,
      intent_detected: 'write_listing',
      listing,
      warnings,
      reasoning_steps: [
        ...reasoning,
        `Price source: ${priceSource}`,
        `Price confidence: ${(priceConfidence * 100).toFixed(0)}%`,
      ],
      tools_used,
    };
  }

  private async checkSafety(
    context: TradeContext,
    reasoning: string[],
    tools_used: string[]
  ): Promise<TradeResponse> {
    const text = context.itemDescription ?? '';
    tools_used.push('check_safety');
    reasoning.push('Running safety check');

    const result = await tools.check_safety(text);
    reasoning.push(`Risk level: ${result.risk_level}`);

    const emoji = result.risk_level === 'high' ? '🔴' : result.risk_level === 'medium' ? '🟡' : '🟢';
    const message =
      `${emoji} 안전 체크 결과: ${result.risk_level.toUpperCase()}\n` +
      (result.warnings.length > 0
        ? `\n주의사항:\n${result.warnings.map((w) => `• ${w}`).join('\n')}`
        : '\n특이 사항 없음. 안전한 거래로 보입니다.');

    return {
      message,
      intent_detected: 'check_safety',
      warnings: result.warnings,
      reasoning_steps: reasoning,
      tools_used,
    };
  }

  private async preparePurchase(
    context: TradeContext,
    reasoning: string[],
    tools_used: string[]
  ): Promise<TradeResponse> {
    const productUrl = this.extractSourceUrl(context);
    if (!productUrl) {
      return {
        message: '구매 준비를 진행할 AliExpress 또는 Amazon 상품 URL이 필요합니다.',
        intent_detected: 'prepare_purchase',
        warnings: ['sourceUrl is required'],
        reasoning_steps: reasoning,
        tools_used,
      };
    }

    tools_used.push('global_buyer');
    reasoning.push(`Preparing purchase for ${productUrl}`);

    const globalPurchase = await tools.prepareGlobalPurchase({
      productUrl,
      platform: context.sourcePlatform,
      action: context.purchaseAction || 'add_to_cart',
      dryRun: context.dryRun ?? true,
      sessionId: context.userId || 'expert-trader',
    });
    reasoning.push(`Global purchase status: ${globalPurchase.status}`);

    const message =
      `🛒 글로벌 구매 준비 상태\n` +
      `- 플랫폼: ${globalPurchase.platform}\n` +
      `- 상태: ${globalPurchase.status}\n` +
      `- 액션: ${globalPurchase.action}${globalPurchase.dry_run ? ' (dry run)' : ''}\n` +
      `- 상품명: ${globalPurchase.product_title || '확인 불가'}\n` +
      `- 사용 셀렉터: ${globalPurchase.selector_used || '없음'}\n` +
      `- 안전 가드: 결제 버튼은 누르지 않음\n` +
      `- 메시지: ${globalPurchase.message}`;

    return {
      message,
      intent_detected: 'prepare_purchase',
      global_purchase: globalPurchase,
      warnings: globalPurchase.warnings,
      reasoning_steps: reasoning,
      tools_used,
    };
  }

  private async generalChat(
    context: TradeContext,
    reasoning: string[],
    tools_used: string[]
  ): Promise<TradeResponse> {
    tools_used.push('gemini-2.5-flash');
    reasoning.push('Generating response with Gemini');

    const SYSTEM_PROMPT =
      '당신은 중고거래 전문가 봇 에덴(Eden)입니다. ' +
      '중고 직거래 플랫폼 EDENCLAW의 AI 어시스턴트로, ' +
      '시세 분석, 협상 전략, 판매글 작성을 도와줍니다. ' +
      '친근하고 전문적으로, 한국어로 답변해주세요.';

    const model = this.gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const history = (context.history ?? []).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });

    const result = await chat.sendMessage(context.itemDescription ?? '안녕하세요');
    const text = result.response.text();

    return { message: text, intent_detected: 'general_chat', reasoning_steps: reasoning, tools_used };
  }
}
