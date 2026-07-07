-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PHYSICAL', 'DIGITAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "budgetRange" TEXT,
    "region" TEXT,
    "sponsorId" TEXT,
    "parentId" TEXT,
    "position" TEXT,
    "epBalance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leftPV" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rightPV" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leftBV" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rightBV" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenQuota" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "allocated" BIGINT NOT NULL DEFAULT 2000000,
    "consumed" BIGINT NOT NULL DEFAULT 0,
    "isOverdraftAdvanced" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "txType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "pvGenerated" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "bvGenerated" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "agentSlug" TEXT NOT NULL DEFAULT 'default',
    "message" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🤖',
    "category" TEXT NOT NULL DEFAULT 'general',
    "personality" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL,
    "skills" TEXT NOT NULL DEFAULT '[]',
    "tier" TEXT NOT NULL DEFAULT 'standard',
    "priceET" INTEGER NOT NULL DEFAULT 0,
    "perUseET" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAutonomous" BOOLEAN NOT NULL DEFAULT false,
    "tools" TEXT NOT NULL DEFAULT '[]',
    "offlineCapable" BOOLEAN NOT NULL DEFAULT true,
    "knowledgeBase" TEXT NOT NULL DEFAULT '[]',
    "growthData" TEXT NOT NULL DEFAULT '{}',
    "localModelSize" TEXT NOT NULL DEFAULT '1.5B',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cronExpr" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRun" TIMESTAMP(3),
    "nextRun" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheck" TIMESTAMP(3),
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL DEFAULT 'conversation',
    "content" TEXT NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccess" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvolution" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "prevPrompt" TEXT NOT NULL,
    "newPrompt" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scoreBefore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreAfter" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatFeedback" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Knowledge" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "embedding" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMetrics" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "totalChats" INTEGER NOT NULL DEFAULT 0,
    "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "knowledgeHits" INTEGER NOT NULL DEFAULT 0,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLearning" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "quality" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'conversation',
    "learned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLearning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "type" "ProductType" NOT NULL DEFAULT 'PHYSICAL',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "pvValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "bvValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "currency" TEXT NOT NULL DEFAULT 'ET',
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "images" TEXT NOT NULL DEFAULT '[]',
    "sellerId" TEXT,
    "sellerName" TEXT NOT NULL DEFAULT '익명',
    "sellerRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "verifiedAt" TIMESTAMP(3),
    "verifyScore" DOUBLE PRECISION,
    "verifyComment" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "buyCount" INTEGER NOT NULL DEFAULT 0,
    "embedding" TEXT,
    "region" TEXT NOT NULL DEFAULT '서울',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mobile_photo',
    "status" TEXT NOT NULL DEFAULT 'PHOTO_CAPTURED',
    "title" TEXT,
    "category" TEXT,
    "condition" TEXT,
    "description" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "tradeMethod" TEXT NOT NULL DEFAULT 'personal_trade',
    "aiAnalysis" TEXT NOT NULL DEFAULT '{}',
    "riskFlags" TEXT NOT NULL DEFAULT '[]',
    "previewCard" TEXT NOT NULL DEFAULT '{}',
    "sellerAgentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publishedProductId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "privateInfo" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL DEFAULT 'seller',
    "status" TEXT NOT NULL DEFAULT 'SELLER_AGENT_ACTIVE',
    "userId" TEXT,
    "context" TEXT NOT NULL DEFAULT '{}',
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentActionLog" (
    "id" TEXT NOT NULL,
    "draftId" TEXT,
    "sessionId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "input" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT NOT NULL DEFAULT '{}',
    "requiresUserConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT,
    "buyerName" TEXT NOT NULL DEFAULT '익명 구매자',
    "buyerMessage" TEXT NOT NULL DEFAULT '',
    "offerPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "status" TEXT NOT NULL DEFAULT 'USER_CONFIRM_REQUIRED',
    "agentReply" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "buyerId" TEXT,
    "buyerEmail" TEXT,
    "buyerName" TEXT NOT NULL DEFAULT '익명',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ET',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "groupBuyId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupBuy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "targetCount" INTEGER NOT NULL,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "discountedPrice" DOUBLE PRECISION NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "embedding" TEXT,
    "region" TEXT NOT NULL DEFAULT '서울',
    "budgetMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budgetMax" DOUBLE PRECISION NOT NULL DEFAULT 999999,
    "matchScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupBuy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupBuyParticipant" (
    "id" TEXT NOT NULL,
    "groupBuyId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL DEFAULT '익명',
    "email" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupBuyParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL DEFAULT '익명',
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "helpful" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVerification" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "scores" TEXT NOT NULL DEFAULT '{}',
    "priceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellerScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "descriptionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metaScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comments" TEXT NOT NULL DEFAULT '{}',
    "grade" TEXT NOT NULL DEFAULT '',
    "priceComment" TEXT NOT NULL DEFAULT '',
    "sellerComment" TEXT NOT NULL DEFAULT '',
    "descriptionComment" TEXT NOT NULL DEFAULT '',
    "metaComment" TEXT NOT NULL DEFAULT '',
    "reviewComment" TEXT NOT NULL DEFAULT '',
    "overallComment" TEXT NOT NULL DEFAULT '',
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "risks" TEXT NOT NULL DEFAULT '[]',
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerReputation" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "responseSpeed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "responseSpeedSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "claimRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeDays" INTEGER NOT NULL DEFAULT 0,
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "badge" TEXT NOT NULL DEFAULT '브론즈',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerReputation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBehavior" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "productId" TEXT,
    "query" TEXT,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBehavior_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationSession" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "buyerId" TEXT,
    "sellerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "initialPrice" DOUBLE PRECISION NOT NULL,
    "agreedPrice" DOUBLE PRECISION,
    "finalPrice" DOUBLE PRECISION,
    "transcript" TEXT NOT NULL DEFAULT '[]',
    "currentTurn" INTEGER NOT NULL DEFAULT 0,
    "maxTurns" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NegotiationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proposedPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegotiationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwarmBot" (
    "id" TEXT NOT NULL,
    "persona" TEXT NOT NULL DEFAULT '{}',
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "memory" TEXT NOT NULL DEFAULT '{}',
    "reputation" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "totalEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'sleeping',
    "botType" TEXT NOT NULL DEFAULT 'multipurpose',
    "parentBotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwarmBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwarmTransaction" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productInfo" TEXT NOT NULL DEFAULT '{}',
    "finalPrice" DOUBLE PRECISION NOT NULL,
    "negotiationLog" TEXT NOT NULL DEFAULT '[]',
    "marketKeyword" TEXT NOT NULL DEFAULT '',
    "sessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwarmTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwarmMarketSession" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "participatingBots" TEXT NOT NULL DEFAULT '[]',
    "duration" INTEGER NOT NULL DEFAULT 0,
    "totalTransactions" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SwarmMarketSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotReferralChain" (
    "id" TEXT NOT NULL,
    "parentBotId" TEXT NOT NULL,
    "childBotId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotReferralChain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellSession" (
    "id" TEXT NOT NULL,
    "draftId" TEXT,
    "userId" TEXT,
    "step" TEXT NOT NULL DEFAULT 'photo_uploaded',
    "context" TEXT NOT NULL DEFAULT '{}',
    "lastMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_sponsorId_idx" ON "User"("sponsorId");

-- CreateIndex
CREATE INDEX "User_parentId_idx" ON "User"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "LegBalance_userId_key" ON "LegBalance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TokenQuota_userId_key" ON "TokenQuota"("userId");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_txType_idx" ON "Transaction"("txType");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");

-- CreateIndex
CREATE INDEX "AgentMemory_agentSlug_userId_idx" ON "AgentMemory"("agentSlug", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMetrics_agentSlug_key" ON "AgentMetrics"("agentSlug");

-- CreateIndex
CREATE INDEX "AgentLearning_agentSlug_quality_idx" ON "AgentLearning"("agentSlug", "quality");

-- CreateIndex
CREATE INDEX "ProductDraft_userId_createdAt_idx" ON "ProductDraft"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductDraft_status_idx" ON "ProductDraft"("status");

-- CreateIndex
CREATE INDEX "ProductDraft_publishedProductId_idx" ON "ProductDraft"("publishedProductId");

-- CreateIndex
CREATE INDEX "ProductImage_draftId_idx" ON "ProductImage"("draftId");

-- CreateIndex
CREATE INDEX "AgentSession_listingId_status_idx" ON "AgentSession"("listingId", "status");

-- CreateIndex
CREATE INDEX "AgentActionLog_draftId_createdAt_idx" ON "AgentActionLog"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentActionLog_sessionId_createdAt_idx" ON "AgentActionLog"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentActionLog_action_idx" ON "AgentActionLog"("action");

-- CreateIndex
CREATE INDEX "Offer_listingId_status_idx" ON "Offer"("listingId", "status");

-- CreateIndex
CREATE INDEX "Offer_createdAt_idx" ON "Offer"("createdAt");

-- CreateIndex
CREATE INDEX "GroupBuyParticipant_groupBuyId_idx" ON "GroupBuyParticipant"("groupBuyId");

-- CreateIndex
CREATE INDEX "Review_productId_idx" ON "Review"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVerification_productId_key" ON "ProductVerification"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerReputation_sellerId_key" ON "SellerReputation"("sellerId");

-- CreateIndex
CREATE INDEX "PriceHistory_productId_date_idx" ON "PriceHistory"("productId", "date");

-- CreateIndex
CREATE INDEX "PriceHistory_productId_recordedAt_idx" ON "PriceHistory"("productId", "recordedAt");

-- CreateIndex
CREATE INDEX "UserBehavior_userId_createdAt_idx" ON "UserBehavior"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserBehavior_action_idx" ON "UserBehavior"("action");

-- CreateIndex
CREATE INDEX "SwarmBot_status_idx" ON "SwarmBot"("status");

-- CreateIndex
CREATE INDEX "SwarmBot_reputation_idx" ON "SwarmBot"("reputation");

-- CreateIndex
CREATE INDEX "SwarmTransaction_timestamp_idx" ON "SwarmTransaction"("timestamp");

-- CreateIndex
CREATE INDEX "SwarmTransaction_marketKeyword_idx" ON "SwarmTransaction"("marketKeyword");

-- CreateIndex
CREATE INDEX "SwarmTransaction_status_idx" ON "SwarmTransaction"("status");

-- CreateIndex
CREATE INDEX "SwarmMarketSession_keyword_idx" ON "SwarmMarketSession"("keyword");

-- CreateIndex
CREATE INDEX "SwarmMarketSession_startedAt_idx" ON "SwarmMarketSession"("startedAt");

-- CreateIndex
CREATE INDEX "BotReferralChain_parentBotId_idx" ON "BotReferralChain"("parentBotId");

-- CreateIndex
CREATE INDEX "BotReferralChain_childBotId_idx" ON "BotReferralChain"("childBotId");

-- CreateIndex
CREATE INDEX "SellSession_draftId_idx" ON "SellSession"("draftId");

-- CreateIndex
CREATE INDEX "SellSession_userId_createdAt_idx" ON "SellSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SellSession_step_idx" ON "SellSession"("step");

-- AddForeignKey
ALTER TABLE "LegBalance" ADD CONSTRAINT "LegBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenQuota" ADD CONSTRAINT "TokenQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_agentSlug_fkey" FOREIGN KEY ("agentSlug") REFERENCES "Agent"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_agentSlug_fkey" FOREIGN KEY ("agentSlug") REFERENCES "Agent"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDraft" ADD CONSTRAINT "ProductDraft_publishedProductId_fkey" FOREIGN KEY ("publishedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ProductDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActionLog" ADD CONSTRAINT "AgentActionLog_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ProductDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActionLog" ADD CONSTRAINT "AgentActionLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "GroupBuy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBuyParticipant" ADD CONSTRAINT "GroupBuyParticipant_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "GroupBuy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVerification" ADD CONSTRAINT "ProductVerification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBehavior" ADD CONSTRAINT "UserBehavior_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationSession" ADD CONSTRAINT "NegotiationSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationMessage" ADD CONSTRAINT "NegotiationMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "NegotiationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwarmTransaction" ADD CONSTRAINT "SwarmTransaction_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "SwarmBot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwarmTransaction" ADD CONSTRAINT "SwarmTransaction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SwarmBot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotReferralChain" ADD CONSTRAINT "BotReferralChain_parentBotId_fkey" FOREIGN KEY ("parentBotId") REFERENCES "SwarmBot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotReferralChain" ADD CONSTRAINT "BotReferralChain_childBotId_fkey" FOREIGN KEY ("childBotId") REFERENCES "SwarmBot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
