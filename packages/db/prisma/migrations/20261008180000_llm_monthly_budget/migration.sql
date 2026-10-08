-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "llmMonthlyBudgetUsdCents" INTEGER;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "llmMonthlyBudgetUsdCents" INTEGER;

-- Seed per-tier monthly LLM budget caps (USD cents), regardless of current plan.isActive status.
UPDATE "Plan" SET "llmMonthlyBudgetUsdCents" = 500  WHERE "code" = 'essencial';
UPDATE "Plan" SET "llmMonthlyBudgetUsdCents" = 2500 WHERE "code" = 'profissional';
UPDATE "Plan" SET "llmMonthlyBudgetUsdCents" = 3500 WHERE "code" = 'studio';

-- CreateIndex
CREATE INDEX "LlmCallLog_businessId_createdAt_idx" ON "LlmCallLog"("businessId", "createdAt");
