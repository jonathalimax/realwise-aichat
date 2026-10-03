-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('active', 'reserved', 'sold', 'rented', 'inactive');

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priceText" TEXT,
    "priceCents" INTEGER,
    "pricePeriod" TEXT,
    "addressLine" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "listingType" TEXT,
    "transaction" TEXT,
    "bedrooms" INTEGER,
    "parkingSpots" INTEGER,
    "areaM2" INTEGER,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "mileageKm" INTEGER,
    "status" "ListingStatus" NOT NULL DEFAULT 'active',
    "url" TEXT,
    "sourceDocumentId" TEXT,
    "sourceUrl" TEXT,
    "dedupKey" TEXT NOT NULL,
    "extractedAt" TIMESTAMP(3),
    "lastSeenInSourceAt" TIMESTAMP(3),
    "overriddenFields" JSONB NOT NULL DEFAULT '{}',
    "manuallyCreated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingImage" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Listing_businessId_status_idx" ON "Listing"("businessId", "status");

-- CreateIndex
CREATE INDEX "Listing_businessId_status_listingType_transaction_idx" ON "Listing"("businessId", "status", "listingType", "transaction");

-- CreateIndex
CREATE INDEX "Listing_businessId_status_priceCents_idx" ON "Listing"("businessId", "status", "priceCents");

-- CreateIndex
CREATE INDEX "Listing_businessId_status_neighborhood_idx" ON "Listing"("businessId", "status", "neighborhood");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_businessId_dedupKey_key" ON "Listing"("businessId", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_businessId_referenceCode_key" ON "Listing"("businessId", "referenceCode");

-- CreateIndex
CREATE INDEX "ListingImage_listingId_ordinal_idx" ON "ListingImage"("listingId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ListingImage_listingId_url_key" ON "ListingImage"("listingId", "url");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingImage" ADD CONSTRAINT "ListingImage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
