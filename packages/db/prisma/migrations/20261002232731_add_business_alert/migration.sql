-- CreateTable
CREATE TABLE "BusinessAlert" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "actionLabel" TEXT,
    "actionHref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessAlert_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BusinessAlert" ADD CONSTRAINT "BusinessAlert_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
