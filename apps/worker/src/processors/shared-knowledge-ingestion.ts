import { Job } from "bullmq";
import { prisma } from "@realwise/db";
import { extractTextFromDocument } from "../extract-text";
import { chunkMarkdown } from "../chunking";
import { embedText } from "../embeddings";

export interface SharedKnowledgeIngestionJobData {
  documentId: string;
  localPath: string;
}

// Near-copy of processDocumentIngestion's extract -> chunk -> embed pipeline, writing to the
// shared/global knowledge tables instead of the tenant-scoped ones. Deliberately does NOT fire
// any of the tenant-only side effects document-ingestion.ts triggers (confidence recompute,
// flow-options regenerate, listing-extraction) — shared content is never tenant-specific.
export async function processSharedKnowledgeIngestion(job: Job<SharedKnowledgeIngestionJobData>) {
  const { documentId, localPath } = job.data;
  const document = await prisma.sharedKnowledgeDocument.findUnique({ where: { id: documentId } });
  if (!document) throw new Error(`SharedKnowledgeDocument ${documentId} not found`);

  await prisma.sharedKnowledgeDocument.update({ where: { id: documentId }, data: { status: "processing" } });

  try {
    const { markdown } = await extractTextFromDocument(localPath, document.mimeType);
    const chunks = chunkMarkdown(markdown);

    await prisma.sharedKnowledgeChunk.deleteMany({ where: { documentId } });

    for (const chunk of chunks) {
      const embedding = await embedText(chunk.content);
      const created = await prisma.sharedKnowledgeChunk.create({
        data: {
          documentId,
          niche: document.niche,
          ordinal: chunk.ordinal,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
        },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "SharedKnowledgeChunk" SET embedding = $1::vector WHERE id = $2`,
        `[${embedding.join(",")}]`,
        created.id,
      );
    }

    await prisma.sharedKnowledgeDocument.update({
      where: { id: documentId },
      data: { status: "processed", extractedMarkdown: markdown },
    });
  } catch (error) {
    await prisma.sharedKnowledgeDocument.update({
      where: { id: documentId },
      data: { status: "failed" },
    });
    throw error;
  }
}
