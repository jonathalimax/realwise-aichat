-- Full-text search index for hybrid retrieval (exact keyword matches vector search can miss).
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_content_fts_idx" ON "KnowledgeChunk" USING GIN (to_tsvector('portuguese', content));
