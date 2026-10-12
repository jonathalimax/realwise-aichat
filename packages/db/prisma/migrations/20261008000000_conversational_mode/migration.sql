-- AlterTable
ALTER TABLE "Business" ADD COLUMN "conversationalModeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterEnum
-- Must be its own statement, outside any transaction block that also touches this enum's values
-- in the same migration (Postgres forbids using a newly-added enum value in the same transaction
-- it was added in).
ALTER TYPE "AnswerSource" ADD VALUE 'discovery';
