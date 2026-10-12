-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "listingIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
