-- CreateTable
CREATE TABLE "SharedKnowledgeDocument" (
    "id" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'uploaded',
    "extractedMarkdown" TEXT,
    "version" TEXT,
    "sourceCitation" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedKnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- "embedding" uses pgvector's vector(768) type — Prisma can't emit this column itself, added by
-- hand here following the same pattern as 20261002110000_add_knowledgechunk_fts_gin /
-- the original KnowledgeChunk table in 20261001090302_init.
CREATE TABLE "SharedKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector(768),
    "sectionPath" TEXT,

    CONSTRAINT "SharedKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedKnowledgeDocument_niche_idx" ON "SharedKnowledgeDocument"("niche");

-- CreateIndex
CREATE INDEX "SharedKnowledgeChunk_niche_idx" ON "SharedKnowledgeChunk"("niche");

-- AddForeignKey
ALTER TABLE "SharedKnowledgeChunk" ADD CONSTRAINT "SharedKnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SharedKnowledgeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Full-text search index for hybrid retrieval, same pattern as
-- KnowledgeChunk_content_fts_idx (20261002110000_add_knowledgechunk_fts_gin).
CREATE INDEX IF NOT EXISTS "SharedKnowledgeChunk_content_fts_idx" ON "SharedKnowledgeChunk" USING GIN (to_tsvector('portuguese', content));
