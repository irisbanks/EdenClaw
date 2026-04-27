-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL DEFAULT 'conversation',
    "content" TEXT NOT NULL,
    "importance" REAL NOT NULL DEFAULT 0.5,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccess" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentEvolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "prevPrompt" TEXT NOT NULL,
    "newPrompt" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scoreBefore" REAL NOT NULL DEFAULT 0,
    "scoreAfter" REAL NOT NULL DEFAULT 0,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ChatFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Knowledge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentSlug" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "embedding" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentMetrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentSlug" TEXT NOT NULL,
    "totalChats" INTEGER NOT NULL DEFAULT 0,
    "avgRating" REAL NOT NULL DEFAULT 0,
    "avgLatencyMs" REAL NOT NULL DEFAULT 0,
    "successRate" REAL NOT NULL DEFAULT 1.0,
    "knowledgeHits" INTEGER NOT NULL DEFAULT 0,
    "lastActive" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AgentMemory_agentSlug_userId_idx" ON "AgentMemory"("agentSlug", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMetrics_agentSlug_key" ON "AgentMetrics"("agentSlug");
