-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "websiteContentHash" TEXT,
ADD COLUMN     "websiteSyncedAt" TIMESTAMP(3),
ADD COLUMN     "websiteUrl" TEXT;
