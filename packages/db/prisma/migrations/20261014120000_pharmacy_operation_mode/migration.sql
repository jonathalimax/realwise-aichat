-- Pharmacy operation mode (commerce | attendance). Additive only.
-- New pharmacies start in "attendance" (the entry plan only allows it); rows that already exist keep
-- the behaviour they had (they all sold through the system), so they are backfilled to "commerce".
-- The effective mode is still forced to attendance at runtime when the plan lacks pharmacyCommerce.

-- CreateEnum
CREATE TYPE "PharmacyOperationMode" AS ENUM ('commerce', 'attendance');

-- AlterEnum
ALTER TYPE "HandoffReason" ADD VALUE 'product_request';

-- AlterTable
ALTER TABLE "PharmacySettings" ADD COLUMN     "operationMode" "PharmacyOperationMode" NOT NULL DEFAULT 'attendance',
ADD COLUMN     "operationModeChosenAt" TIMESTAMP(3);

-- Existing pharmacies keep selling through the system.
UPDATE "PharmacySettings" SET "operationMode" = 'commerce';
