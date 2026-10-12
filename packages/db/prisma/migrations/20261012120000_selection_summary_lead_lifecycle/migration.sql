-- Additive only: new nullable/defaulted columns + one index. No drops, renames, type changes or
-- data rewrites. Existing leads get status 'new' via the column default.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "engagementState" JSONB,
ADD COLUMN     "selectedListingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "teamSummary" JSONB,
ADD COLUMN     "teamSummaryUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "intent" TEXT,
ADD COLUMN     "interestListingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sourceConversationId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'new',
ADD COLUMN     "statusUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "summary" JSONB,
ADD COLUMN     "summaryUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "waitingFor" TEXT;

-- CreateIndex
CREATE INDEX "Lead_businessId_status_idx" ON "Lead"("businessId", "status");
