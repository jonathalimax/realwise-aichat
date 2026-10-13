-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('invited', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('standard', 'human_joined');

-- CreateEnum
CREATE TYPE "ProductClass" AS ENUM ('unclassified', 'otc', 'prescription', 'controlled');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_pharmacist', 'confirmed', 'out_for_delivery', 'ready_for_pickup', 'delivered', 'canceled', 'rejected');

-- CreateEnum
CREATE TYPE "Fulfillment" AS ENUM ('delivery', 'pickup');

-- CreateEnum
CREATE TYPE "CatalogImportStatus" AS ENUM ('uploaded', 'mapped', 'reviewing', 'applied', 'failed');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "HandoffReason" AS ENUM ('symptom', 'rx', 'controlled', 'out_of_stock', 'other');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('open', 'answered', 'closed');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "primaryColor" TEXT,
ADD COLUMN     "secondaryColor" TEXT,
ADD COLUMN     "tertiaryColor" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "authorMemberId" TEXT,
ADD COLUMN     "authorName" TEXT,
ADD COLUMN     "authorRole" TEXT,
ADD COLUMN     "kind" "MessageKind" NOT NULL DEFAULT 'standard';

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "requiresCrf" BOOLEAN NOT NULL DEFAULT false,
    "ownDeliveriesOnly" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessMember" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "phone" TEXT,
    "roleId" TEXT NOT NULL,
    "crf" TEXT,
    "status" "MemberStatus" NOT NULL DEFAULT 'invited',
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberInvite" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLogEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "memberId" TEXT,
    "memberName" TEXT,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "target" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "reference" TEXT,
    "district" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "ean" TEXT,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "activeIngredient" TEXT,
    "presentation" TEXT,
    "manufacturer" TEXT,
    "category" TEXT,
    "priceCents" INTEGER NOT NULL,
    "stockQty" INTEGER,
    "stockAsOf" TIMESTAMP(3),
    "imageKey" TEXT,
    "saleClass" "ProductClass" NOT NULL DEFAULT 'unclassified',
    "classProposed" "ProductClass",
    "classProposedBy" TEXT,
    "classProposedReason" TEXT,
    "classConfirmedAt" TIMESTAMP(3),
    "classConfirmedBy" TEXT,
    "pharmacistRequired" BOOLEAN NOT NULL DEFAULT false,
    "maxQtyPerOrder" INTEGER,
    "equivalentGroup" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceImportId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "overriddenFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImport" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "CatalogImportStatus" NOT NULL DEFAULT 'uploaded',
    "columnMapping" JSONB NOT NULL DEFAULT '{}',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "stockAsOf" TIMESTAMP(3),
    "error" TEXT,
    "createdByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "statusToken" TEXT NOT NULL,
    "fulfillment" "Fulfillment" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_pharmacist',
    "paymentMethod" TEXT NOT NULL DEFAULT 'on_delivery',
    "subtotalCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "addressSnapshot" JSONB,
    "addressDiffersFromSaved" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "autoConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "hasPrescription" BOOLEAN NOT NULL DEFAULT false,
    "stockAsOfSnapshot" TIMESTAMP(3),
    "statusReason" TEXT,
    "courierMemberId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "saleClassSnapshot" "ProductClass" NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionUpload" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "patientName" TEXT,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'pending',
    "reviewedAt" TIMESTAMP(3),
    "reviewedByMemberId" TEXT,
    "reviewedByName" TEXT,
    "rejectReason" TEXT,
    "consentId" TEXT,
    "retentionDeleteAt" TIMESTAMP(3),
    "fileDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacistHandoff" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "leadId" TEXT,
    "reason" "HandoffReason" NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL DEFAULT '',
    "brief" JSONB NOT NULL DEFAULT '{}',
    "status" "HandoffStatus" NOT NULL DEFAULT 'open',
    "answerText" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answeredByMemberId" TEXT,
    "answeredByName" TEXT,
    "answeredByRole" TEXT,
    "closedAt" TIMESTAMP(3),
    "retentionDeleteAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PharmacistHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacySettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "legalName" TEXT,
    "cnpj" TEXT,
    "afeNumber" TEXT,
    "pharmacistName" TEXT,
    "pharmacistCrf" TEXT,
    "deliveryAreas" JSONB NOT NULL DEFAULT '[]',
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "minOrderCents" INTEGER NOT NULL DEFAULT 0,
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoConfirmEnabled" BOOLEAN NOT NULL DEFAULT true,
    "stockMaxAgeHours" INTEGER NOT NULL DEFAULT 24,
    "openingHours" JSONB NOT NULL DEFAULT '[]',
    "paymentMethods" TEXT[] DEFAULT ARRAY['pix', 'cartao', 'dinheiro']::TEXT[],
    "exchangePolicy" TEXT,
    "maxQtyPerItemDefault" INTEGER,
    "prescriptionRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "orderReminderMinutes" INTEGER NOT NULL DEFAULT 10,
    "quickChips" JSONB NOT NULL DEFAULT '[]',
    "proposals" JSONB NOT NULL DEFAULT '{}',
    "nextOrderNumber" INTEGER NOT NULL DEFAULT 1001,
    "nextRxNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Role_businessId_idx" ON "Role"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_businessId_key_key" ON "Role"("businessId", "key");

-- CreateIndex
CREATE INDEX "BusinessMember_businessId_status_idx" ON "BusinessMember"("businessId", "status");

-- CreateIndex
CREATE INDEX "BusinessMember_email_idx" ON "BusinessMember"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMember_businessId_email_key" ON "BusinessMember"("businessId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MemberInvite_tokenHash_key" ON "MemberInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberInvite_businessId_idx" ON "MemberInvite"("businessId");

-- CreateIndex
CREATE INDEX "AccessLogEntry_businessId_createdAt_idx" ON "AccessLogEntry"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLogEntry_businessId_memberId_createdAt_idx" ON "AccessLogEntry"("businessId", "memberId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerAddress_businessId_leadId_isDefault_idx" ON "CustomerAddress"("businessId", "leadId", "isDefault");

-- CreateIndex
CREATE INDEX "Product_businessId_saleClass_active_idx" ON "Product"("businessId", "saleClass", "active");

-- CreateIndex
CREATE INDEX "Product_businessId_ean_idx" ON "Product"("businessId", "ean");

-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_dedupKey_key" ON "Product"("businessId", "dedupKey");

-- CreateIndex
CREATE INDEX "CatalogImport_businessId_createdAt_idx" ON "CatalogImport"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_statusToken_key" ON "Order"("statusToken");

-- CreateIndex
CREATE INDEX "Order_businessId_status_createdAt_idx" ON "Order"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_businessId_leadId_idx" ON "Order"("businessId", "leadId");

-- CreateIndex
CREATE INDEX "Order_businessId_courierMemberId_idx" ON "Order"("businessId", "courierMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_businessId_number_key" ON "Order"("businessId", "number");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "PrescriptionUpload_businessId_status_createdAt_idx" ON "PrescriptionUpload"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PrescriptionUpload_orderId_idx" ON "PrescriptionUpload"("orderId");

-- CreateIndex
CREATE INDEX "PrescriptionUpload_retentionDeleteAt_idx" ON "PrescriptionUpload"("retentionDeleteAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionUpload_businessId_number_key" ON "PrescriptionUpload"("businessId", "number");

-- CreateIndex
CREATE INDEX "PharmacistHandoff_businessId_status_createdAt_idx" ON "PharmacistHandoff"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PharmacistHandoff_conversationId_idx" ON "PharmacistHandoff"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacySettings_businessId_key" ON "PharmacySettings"("businessId");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "BusinessMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLogEntry" ADD CONSTRAINT "AccessLogEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_sourceImportId_fkey" FOREIGN KEY ("sourceImportId") REFERENCES "CatalogImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImport" ADD CONSTRAINT "CatalogImport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImport" ADD CONSTRAINT "CatalogImport_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_courierMemberId_fkey" FOREIGN KEY ("courierMemberId") REFERENCES "BusinessMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionUpload" ADD CONSTRAINT "PrescriptionUpload_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionUpload" ADD CONSTRAINT "PrescriptionUpload_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistHandoff" ADD CONSTRAINT "PharmacistHandoff_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySettings" ADD CONSTRAINT "PharmacySettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (idempotent): starter roles for every existing business + an Owner member per business.
-- Starter grids come from packages/shared/src/permissions.ts (generated from it; keep in sync).

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'owner', 'Proprietário', 'Acesso total. Sempre existe ao menos um.', true, false, false, '{"inicio":"edit","conversas":"edit","analises":"view","equipe":"edit","plano":"edit","leads":"edit","imoveis":"edit","agenda":"edit","conhecimento":"edit","configuracoes":"edit","pedidos":"none","receitas":"none","atendimento":"none","catalogo":"none","importar":"none","classes":"none","clientes":"none","farmacia":"none"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'imobiliaria'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'manager', 'Gerente', 'Gerencia operação, catálogo, equipe e plano. Não altera proprietários.', true, false, false, '{"inicio":"edit","conversas":"edit","analises":"view","equipe":"edit","plano":"edit","leads":"edit","imoveis":"edit","agenda":"edit","conhecimento":"edit","configuracoes":"edit","pedidos":"none","receitas":"none","atendimento":"none","catalogo":"none","importar":"none","classes":"none","clientes":"none","farmacia":"none"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'imobiliaria'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'attendant', 'Atendente', 'Acompanha e atende pedidos, consulta catálogo e clientes.', true, false, false, '{"inicio":"view","conversas":"edit","analises":"none","equipe":"none","plano":"none","leads":"edit","imoveis":"view","agenda":"edit","conhecimento":"view","configuracoes":"none","pedidos":"none","receitas":"none","atendimento":"none","catalogo":"none","importar":"none","classes":"none","clientes":"none","farmacia":"none"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'imobiliaria'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'owner', 'Proprietário', 'Acesso total. Sempre existe ao menos um.', true, false, false, '{"inicio":"edit","conversas":"edit","analises":"view","equipe":"edit","plano":"edit","leads":"edit","imoveis":"edit","agenda":"edit","conhecimento":"edit","configuracoes":"edit","pedidos":"none","receitas":"none","atendimento":"none","catalogo":"none","importar":"none","classes":"none","clientes":"none","farmacia":"none"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'concessionaria'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'manager', 'Gerente', 'Gerencia operação, catálogo, equipe e plano. Não altera proprietários.', true, false, false, '{"inicio":"edit","conversas":"edit","analises":"view","equipe":"edit","plano":"edit","leads":"edit","imoveis":"edit","agenda":"edit","conhecimento":"edit","configuracoes":"edit","pedidos":"none","receitas":"none","atendimento":"none","catalogo":"none","importar":"none","classes":"none","clientes":"none","farmacia":"none"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'concessionaria'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'attendant', 'Atendente', 'Acompanha e atende pedidos, consulta catálogo e clientes.', true, false, false, '{"inicio":"view","conversas":"edit","analises":"none","equipe":"none","plano":"none","leads":"edit","imoveis":"view","agenda":"edit","conhecimento":"view","configuracoes":"none","pedidos":"none","receitas":"none","atendimento":"none","catalogo":"none","importar":"none","classes":"none","clientes":"none","farmacia":"none"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'concessionaria'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'owner', 'Proprietário', 'Acesso total. Sempre existe ao menos um.', true, false, false, '{"inicio":"view","conversas":"view","analises":"view","equipe":"edit","plano":"edit","leads":"none","imoveis":"none","agenda":"none","conhecimento":"none","configuracoes":"none","pedidos":"edit","receitas":"view","atendimento":"view","catalogo":"edit","importar":"edit","classes":"view","clientes":"edit","farmacia":"edit"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'farmacia'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'pharmacist', 'Farmacêutico RT', 'Valida receitas, confirma classes e responde atendimentos. Exige CRF.', true, true, false, '{"inicio":"view","conversas":"view","analises":"view","equipe":"none","plano":"none","leads":"none","imoveis":"none","agenda":"none","conhecimento":"none","configuracoes":"none","pedidos":"edit","receitas":"edit","atendimento":"edit","catalogo":"edit","importar":"edit","classes":"edit","clientes":"view","farmacia":"view"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'farmacia'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'manager', 'Gerente', 'Gerencia operação, catálogo, equipe e plano. Não altera proprietários.', true, false, false, '{"inicio":"view","conversas":"view","analises":"view","equipe":"edit","plano":"edit","leads":"none","imoveis":"none","agenda":"none","conhecimento":"none","configuracoes":"none","pedidos":"edit","receitas":"view","atendimento":"view","catalogo":"edit","importar":"edit","classes":"none","clientes":"edit","farmacia":"edit"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'farmacia'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'attendant', 'Atendente', 'Acompanha e atende pedidos, consulta catálogo e clientes.', true, false, false, '{"inicio":"view","conversas":"view","analises":"none","equipe":"none","plano":"none","leads":"none","imoveis":"none","agenda":"none","conhecimento":"none","configuracoes":"none","pedidos":"edit","receitas":"view","atendimento":"none","catalogo":"view","importar":"none","classes":"none","clientes":"view","farmacia":"none"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'farmacia'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "Role" ("id","businessId","key","name","description","isStarter","requiresCrf","ownDeliveriesOnly","permissions","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", 'courier', 'Entregador', 'Vê somente as próprias entregas.', true, false, true, '{"inicio":"none","conversas":"none","analises":"none","equipe":"none","plano":"none","leads":"none","imoveis":"none","agenda":"none","conhecimento":"none","configuracoes":"none","pedidos":"edit","receitas":"none","atendimento":"none","catalogo":"none","importar":"none","classes":"none","clientes":"none","farmacia":"none"}'::jsonb, now(), now()
FROM "Business" b WHERE b."niche"::text = 'farmacia'
ON CONFLICT ("businessId","key") DO NOTHING;

INSERT INTO "BusinessMember" ("id","businessId","email","name","phone","roleId","status","createdAt","updatedAt")
SELECT gen_random_uuid()::text, b."id", NULLIF(lower(trim(b."email")), ''), COALESCE(NULLIF(trim(b."ownerName"), ''), 'Proprietário'), b."phone", r."id", 'active', now(), now()
FROM "Business" b
JOIN "Role" r ON r."businessId" = b."id" AND r."key" = 'owner'
WHERE NOT EXISTS (SELECT 1 FROM "BusinessMember" m WHERE m."businessId" = b."id")
ON CONFLICT DO NOTHING;

