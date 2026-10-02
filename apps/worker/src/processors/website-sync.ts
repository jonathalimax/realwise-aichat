import { Job } from "bullmq";
import { prisma } from "@realwise/db";
import { fetchWebsiteText } from "../website-extract";
import { chunkMarkdown } from "../chunking";
import { embedText } from "../embeddings";
import { callInternalApi } from "../internal-api";

export interface WebsiteSyncJobData {
  businessId: string;
}

export async function processWebsiteSync(job: Job<WebsiteSyncJobData>) {
  const { businessId } = job.data;
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business || !business.websiteUrl) return;

  const { markdown, contentHash, pagesVisited } = await fetchWebsiteText(business.websiteUrl);
  console.log(`website-sync ${businessId}: crawled ${pagesVisited} page(s)`);

  if (contentHash === business.websiteContentHash) {
    await prisma.business.update({ where: { id: businessId }, data: { websiteSyncedAt: new Date() } });
    return;
  }

  let document = await prisma.knowledgeDocument.findFirst({ where: { businessId, source: "website_sync" } });
  if (!document) {
    document = await prisma.knowledgeDocument.create({
      data: {
        businessId,
        filename: "Site oficial",
        mimeType: "text/html",
        sizeBytes: Buffer.byteLength(markdown),
        storageKey: `website-sync/${businessId}`,
        source: "website_sync",
        status: "processing",
      },
    });
  } else {
    await prisma.knowledgeDocument.update({ where: { id: document.id }, data: { status: "processing", sizeBytes: Buffer.byteLength(markdown) } });
  }

  try {
    const chunks = chunkMarkdown(markdown);
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: document.id } });

    for (const chunk of chunks) {
      const embedding = await embedText(chunk.content);
      const created = await prisma.knowledgeChunk.create({
        data: {
          businessId,
          documentId: document.id,
          ordinal: chunk.ordinal,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
        },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE "KnowledgeChunk" SET embedding = $1::vector WHERE id = $2`,
        `[${embedding.join(",")}]`,
        created.id,
      );
    }

    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: "processed", extractedMarkdown: markdown },
    });
    await prisma.business.update({
      where: { id: businessId },
      data: { websiteContentHash: contentHash, websiteSyncedAt: new Date() },
    });

    await Promise.all([
      callInternalApi("/confidence/recompute", businessId),
      callInternalApi("/flow-options/regenerate", businessId),
    ]);
  } catch (error) {
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: "failed", processingError: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
