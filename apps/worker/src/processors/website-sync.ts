import { createHash } from "crypto";
import { Job } from "bullmq";
import { prisma } from "@realwise/db";
import { fetchWebsiteText, CrawledPage } from "../website-extract";
import { chunkMarkdown } from "../chunking";
import { embedText } from "../embeddings";
import { callInternalApi } from "../internal-api";
import { listingExtractionQueue } from "../queues";

export interface WebsiteSyncJobData {
  businessId: string;
}

function storageKeyFor(businessId: string, url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `website-sync/${businessId}/${hash}`;
}

async function processPage(businessId: string, page: CrawledPage): Promise<boolean> {
  const storageKey = storageKeyFor(businessId, page.url);
  const markdown = `## ${page.title || page.url}\n\n${page.text}\n\nFonte: ${page.url}`;

  let document = await prisma.knowledgeDocument.findFirst({ where: { businessId, source: "website_sync", storageKey } });
  if (!document) {
    document = await prisma.knowledgeDocument.create({
      data: {
        businessId,
        filename: page.title || page.url,
        mimeType: "text/html",
        sizeBytes: Buffer.byteLength(markdown),
        storageKey,
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
    return true;
  } catch (error) {
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: { status: "failed", processingError: error instanceof Error ? error.message : String(error) },
    });
    return false;
  }
}

export async function processWebsiteSync(job: Job<WebsiteSyncJobData>) {
  const { businessId } = job.data;
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business || !business.websiteUrl) return;

  const { pages, contentHash, pagesVisited } = await fetchWebsiteText(business.websiteUrl);
  console.log(`website-sync ${businessId}: crawled ${pagesVisited} page(s)`);

  if (contentHash === business.websiteContentHash) {
    await prisma.business.update({ where: { id: businessId }, data: { websiteSyncedAt: new Date() } });
    return;
  }

  const seenStorageKeys = new Set<string>();
  let successCount = 0;

  for (const page of pages) {
    seenStorageKeys.add(storageKeyFor(businessId, page.url));
    const ok = await processPage(businessId, page);
    if (ok) successCount++;
  }

  if (pages.length > 0 && successCount === 0) {
    throw new Error(`website-sync ${businessId}: all ${pages.length} page(s) failed to process`);
  }

  // Reconcile: drop stale per-page documents for pages that disappeared from the site (or
  // got de-listed) since the previous run, so stale RAG content doesn't linger forever.
  const existing = await prisma.knowledgeDocument.findMany({
    where: { businessId, source: "website_sync" },
    select: { id: true, storageKey: true },
  });
  const staleIds = existing.filter((doc) => !seenStorageKeys.has(doc.storageKey)).map((doc) => doc.id);
  if (staleIds.length > 0) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: { in: staleIds } } });
    await prisma.knowledgeDocument.deleteMany({ where: { id: { in: staleIds } } });
  }

  await prisma.business.update({
    where: { id: businessId },
    data: { websiteContentHash: contentHash, websiteSyncedAt: new Date() },
  });

  await Promise.all([
    callInternalApi("/confidence/recompute", businessId),
    callInternalApi("/flow-options/regenerate", businessId),
  ]);
  await listingExtractionQueue.add(
    "extract",
    { businessId },
    { jobId: `extract-${businessId}`, removeOnComplete: true, removeOnFail: 50 },
  );
}
