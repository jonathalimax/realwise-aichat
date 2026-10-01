-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Niche" AS ENUM ('imobiliaria', 'concessionaria');

-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('onboarding', 'pending_review', 'live', 'suspended', 'churned');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('uploaded', 'processing', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('active', 'idle', 'escalated', 'closed');

-- CreateEnum
CREATE TYPE "AnswerSource" AS ENUM ('fixed_flow', 'rag', 'abstained', 'escalation');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('pending', 'confirmed', 'canceled', 'no_show', 'completed');

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('access', 'deletion', 'correction', 'portability');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "niche" "Niche" NOT NULL,
    "parentBusinessId" TEXT,
    "phone" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "brandColor" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "address" TEXT,
    "status" "BusinessStatus" NOT NULL DEFAULT 'onboarding',
    "confidenceScore" INTEGER NOT NULL DEFAULT 0,
    "confidenceBreakdown" JSONB,
    "publishedAt" TIMESTAMP(3),
    "linkPlacedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceBrlCents" INTEGER NOT NULL,
    "setupFeeBrlCents" INTEGER NOT NULL,
    "conversationQuota" INTEGER NOT NULL,
    "documentQuota" INTEGER NOT NULL,
    "whatsappNumberQuota" INTEGER NOT NULL,
    "features" JSONB NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "stripeSetupPriceId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "setupFeePaidAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "conversationsUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'uploaded',
    "extractedMarkdown" TEXT,
    "ocrUsed" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER,
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionDeleteAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector(768),
    "sectionPath" TEXT,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fieldStatus" JSONB NOT NULL,
    "cachedSummary" TEXT,
    "cachedSummaryTokens" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT,
    "visitorToken" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'active',
    "channel" TEXT,
    "referrer" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "rollingSummary" TEXT,
    "summaryUpdatedAtMessage" INTEGER,
    "escalatedAt" TIMESTAMP(3),
    "escalationNumberId" TEXT,
    "referenceCode" TEXT,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "fixedFlowTurns" INTEGER NOT NULL DEFAULT 0,
    "llmTurns" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answerSource" "AnswerSource",
    "retrievedChunkIds" TEXT[],
    "retrievalTopScore" DOUBLE PRECISION,
    "modelUsed" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "feedback" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnansweredQuestion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedByProfileField" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "UnansweredQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionCount" INTEGER NOT NULL DEFAULT 1,
    "commitmentScore" INTEGER NOT NULL DEFAULT 0,
    "scoreBand" TEXT NOT NULL DEFAULT 'cold',
    "scoreSignals" JSONB,
    "consentId" TEXT,
    "ownerNotes" TEXT,
    "ownerOutcome" TEXT,
    "whatsappContactedAt" TIMESTAMP(3),
    "tags" TEXT[],
    "retentionDeleteAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChipSuggestion" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "afterMessageId" TEXT,
    "label" TEXT NOT NULL,
    "questionText" TEXT,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clickedAt" TIMESTAMP(3),
    "validatedAgainstKb" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChipSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingSlot" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weekday" INTEGER,
    "startTime" TEXT,
    "endTime" TEXT,
    "slotDurationMinutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "serviceId" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BookingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT,
    "conversationId" TEXT,
    "serviceName" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'pending',
    "createdVia" TEXT NOT NULL,
    "notes" TEXT,
    "ownerConfirmedAt" TIMESTAMP(3),
    "externalCalendarEventId" TEXT,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappRoutingNumber" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "businessHours" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lastRoutedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsappRoutingNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT,
    "phoneHash" TEXT NOT NULL,
    "consentTextVersion" TEXT NOT NULL,
    "purposes" TEXT[],
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawalReason" TEXT,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT,
    "type" "DataSubjectRequestType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "fulfillmentNotes" TEXT,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "properties" JSONB,
    "conversationId" TEXT,
    "leadId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCallLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "costEstimateCents" INTEGER,
    "cachedPrefixHit" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Business_phone_key" ON "Business"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_businessId_key" ON "Subscription"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_businessId_key" ON "BusinessProfile"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_businessId_phoneNormalized_key" ON "Lead"("businessId", "phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_phone_key" ON "AdminUser"("phone");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnansweredQuestion" ADD CONSTRAINT "UnansweredQuestion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChipSuggestion" ADD CONSTRAINT "ChipSuggestion_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSlot" ADD CONSTRAINT "BookingSlot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappRoutingNumber" ADD CONSTRAINT "WhatsappRoutingNumber_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
