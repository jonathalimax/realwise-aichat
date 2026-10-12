-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "supportWhatsappNumber" TEXT,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);
