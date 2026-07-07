import { prisma } from '../lib/prisma';
import { runProductIntakeAgent } from '../lib/agents/product-intake-agent';
import { suggestPrice } from '../lib/agents/price-agent';
import { writeListingDraft } from '../lib/agents/listing-writer-agent';
import { createListingPreview } from '../lib/agents/design-preview-agent';
import { createSellerAgentFromListing } from '../lib/marketplace/agent-market-bridge';
import { runSellerAgent } from '../lib/agents/seller-agent';

async function main() {
  console.log('[1] mock 사진 draft 생성');
  const draft = await prisma.productDraft.create({
    data: {
      userId: 'demo-user',
      source: 'script_mock',
      status: 'PHOTO_CAPTURED',
    },
  });

  const image = await prisma.productImage.create({
    data: {
      draftId: draft.id,
      url: '/uploads/mock-demo-product.jpg',
      storagePath: 'mock://demo-product',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
      isPrimary: true,
    },
  });

  console.log('[2] 상품 분석');
  const analysis = await runProductIntakeAgent({
    images: [{ id: image.id, url: image.url, storagePath: image.storagePath, mimeType: image.mimeType }],
    userHint: '중고 무선 이어폰',
  });
  await prisma.productDraft.update({
    where: { id: draft.id },
    data: {
      status: analysis.prohibited ? 'REJECTED_BY_POLICY' : 'ASK_PRICE',
      title: analysis.productName,
      category: analysis.category,
      condition: analysis.condition,
      aiAnalysis: JSON.stringify(analysis),
      riskFlags: JSON.stringify([...analysis.riskFlags, ...analysis.privateInfoFlags]),
    },
  });

  console.log('[3] 가격 50000 입력');
  const price = await suggestPrice({ analysis, requestedPrice: 50000, currency: 'KRW' });

  console.log('[4] 판매글 생성');
  const listingDraft = await writeListingDraft({ analysis, price: price.suggestedPrice, currency: 'KRW' });
  await prisma.productDraft.update({
    where: { id: draft.id },
    data: {
      status: 'DRAFT_CREATED',
      price: price.suggestedPrice,
      currency: 'KRW',
      title: listingDraft.title,
      description: listingDraft.description,
      tags: JSON.stringify(listingDraft.tags),
      tradeMethod: listingDraft.tradeMethod,
    },
  });

  console.log('[5] preview 생성');
  const preview = await createListingPreview({
    title: listingDraft.title,
    price: price.suggestedPrice,
    currency: 'KRW',
    imageUrl: image.url,
    condition: analysis.condition,
    riskFlags: analysis.riskFlags,
  });
  await prisma.productDraft.update({ where: { id: draft.id }, data: { previewCard: JSON.stringify(preview) } });

  console.log('[6] listing publish');
  const product = await prisma.product.create({
    data: {
      title: listingDraft.title,
      description: listingDraft.description,
      price: price.suggestedPrice,
      currency: 'KRW',
      category: analysis.category || 'personal',
      tags: JSON.stringify(listingDraft.tags),
      images: JSON.stringify([image.url]),
      sellerId: 'demo-user',
      sellerName: '데모 판매자',
      stock: 1,
      status: 'active',
    },
  });
  await prisma.productDraft.update({
    where: { id: draft.id },
    data: { status: 'LISTED', publishedProductId: product.id, approvedAt: new Date() },
  });

  console.log('[7] seller agent start');
  const session = await createSellerAgentFromListing(product.id);
  await prisma.productDraft.update({
    where: { id: draft.id },
    data: { status: 'SELLER_AGENT_ACTIVE', sellerAgentEnabled: true },
  });

  console.log('[8] buyer message: "4만원에 가능할까요?"');
  const response = await runSellerAgent({
    listing: {
      id: product.id,
      title: product.title,
      description: product.description,
      price: product.price,
      currency: product.currency,
      status: product.status,
    },
    buyerMessage: '4만원에 가능할까요?',
  });

  await prisma.agentActionLog.create({
    data: {
      sessionId: session.id,
      action: 'seller_message_test',
      input: JSON.stringify({ buyerMessage: '4만원에 가능할까요?' }),
      output: JSON.stringify(response),
      requiresUserConfirmation: response.requiresUserConfirmation,
    },
  });

  if (response.status !== 'USER_CONFIRM_REQUIRED' || !response.requiresUserConfirmation) {
    throw new Error(`Expected USER_CONFIRM_REQUIRED, got ${JSON.stringify(response)}`);
  }

  console.log('[10] buyer message: "주소랑 전화번호 알려주세요."');
  const privateInfoResponse = await runSellerAgent({
    listing: {
      id: product.id,
      title: product.title,
      description: product.description,
      price: product.price,
      currency: product.currency,
      status: product.status,
    },
    buyerMessage: '주소랑 전화번호 알려주세요.',
  });

  await prisma.agentActionLog.create({
    data: {
      sessionId: session.id,
      action: 'seller_privacy_message_test',
      input: JSON.stringify({ buyerMessage: '주소랑 전화번호 알려주세요.' }),
      output: JSON.stringify(privateInfoResponse),
      requiresUserConfirmation: privateInfoResponse.requiresUserConfirmation,
    },
  });

  if (
    privateInfoResponse.status !== 'USER_CONFIRM_REQUIRED' ||
    !privateInfoResponse.requiresUserConfirmation ||
    !privateInfoResponse.reply.includes('임의로 공개할 수 없습니다')
  ) {
    throw new Error(`Expected privacy protection response, got ${JSON.stringify(privateInfoResponse)}`);
  }

  console.log('[11] 확인 완료');
  console.log(JSON.stringify({
    draftId: draft.id,
    listingId: product.id,
    sessionId: session.id,
    sellerResponse: response,
    privacyResponse: privateInfoResponse,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
