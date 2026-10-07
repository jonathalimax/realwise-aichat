-- AlterTable
ALTER TABLE "PlatformConfig" ADD COLUMN     "realEstateRatePercent" DOUBLE PRECISION,
ADD COLUMN     "vehicleRatePercent" DOUBLE PRECISION,
ADD COLUMN     "ratesReferenceMonth" TEXT,
ADD COLUMN     "ratesFetchedAt" TIMESTAMP(3);
