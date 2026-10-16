import { Job } from "bullmq";
import { prisma } from "@realwise/db";
import { extractTextFromDocument } from "../extract-text";
import { chunkMarkdown } from "../chunking";
import { tryEmbedText } from "../embeddings";
import { callInternalApi } from "../internal-api";
import { listingExtractionQueue } from "../queues";

export interface DocumentIngestionJobData {
  documentId: string;
  localPath: string;
}

export async function processDocumentIngestion(job: Job<DocumentIngestionJobData>) {
  const { documentId, localPath } = job.data;
  const document = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
  if (!document) throw new Error(`Document ${documentId} not found`);

  await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: "processing" } });

  try {
    const { markdown, ocrUsed } = await extractTextFromDocument(localPath, document.mimeType);
    const chunks = chunkMarkdown(markdown);

    await prisma.knowledgeChunk.deleteMany({ where: { documentId } });

    for (const chunk of chunks) {
      const embedding = await tryEmbedText(chunk.content);
      const created = await prisma.knowledgeChunk.create({
        data: {
          businessId: document.businessId,
          documentId,
          ordinal: chunk.ordinal,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
        },
      });
      if (embedding) {
        await prisma.$executeRawUnsafe(
          `UPDATE "KnowledgeChunk" SET embedding = $1::vector WHERE id = $2`,
          `[${embedding.join(",")}]`,
          created.id,
        );
      }
    }

    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "processed", extractedMarkdown: markdown, ocrUsed },
    });

    // Follow-ups are best-effort: the document is already searchable, so a hiccup here must not mark it failed.
    try {
      await Promise.all([
        callInternalApi("/confidence/recompute", document.businessId),
        callInternalApi("/flow-options/regenerate", document.businessId),
      ]);
      // Listings (properties / vehicles) do not exist for a pharmacy: its documents are answers, not inventory.
      const business = await prisma.business.findUnique({ where: { id: document.businessId }, select: { niche: true } });
      if (business?.niche !== "farmacia") {
        await listingExtractionQueue.add(
          "extract",
          { businessId: document.businessId },
          { jobId: `extract-${document.businessId}`, removeOnComplete: true, removeOnFail: 50 },
        );
      }
    } catch (followUpError) {
      console.warn(`[document-ingestion] follow-up steps failed for ${documentId}:`, followUpError instanceof Error ? followUpError.message : followUpError);
    }
  } catch (error) {
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "failed", processingError: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
