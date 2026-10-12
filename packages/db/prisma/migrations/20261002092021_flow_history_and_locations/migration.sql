-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "cachedLocations" JSONB,
ADD COLUMN     "cachedLocationsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "flowHistory" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "flowSnapshot" JSONB;
