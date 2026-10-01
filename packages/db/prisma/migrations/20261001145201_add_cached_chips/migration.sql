-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "cachedChips" JSONB,
ADD COLUMN     "cachedChipsAt" TIMESTAMP(3);
