-- Retire the old LLM-suggested chip system (superseded by the flow engine's dynamic bubbles)
-- DropForeignKey
ALTER TABLE "ChipSuggestion" DROP CONSTRAINT IF EXISTS "ChipSuggestion_conversationId_fkey";

-- DropTable
DROP TABLE IF EXISTS "ChipSuggestion";

-- AlterTable
ALTER TABLE "Business" DROP COLUMN IF EXISTS "cachedChips";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "cachedChipsAt";
