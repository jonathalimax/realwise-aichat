import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { PrismaService } from "../../prisma/prisma.service";
import { DocumentIngestionQueue } from "../../queues/document-ingestion.queue";

const STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? "./storage";

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService, private readonly ingestionQueue: DocumentIngestionQueue) {}

  async listDocuments(businessId: string) {
    // Exclude "website_sync" documents — those are internal artifacts created by the
    // listing-extraction worker (one per crawled page, used as RAG source material) rather
    // than something the business owner uploaded or pasted ("catalog_import" = pharmacy stock sheets,
    // managed in the catalog import screen). Owners have no reason to see,
    // edit, or remove them here.
    const docs = await this.prisma.client.knowledgeDocument.findMany({
      where: { businessId, source: { notIn: ["website_sync", "catalog_import", "qa"] } },
      orderBy: { createdAt: "desc" },
    });
    // How each document is searched: semantic vectors, or keyword only when no embedder was available at ingestion.
    const modes = await this.searchModes(businessId);
    return docs.map((d) => ({ ...d, searchMode: modes.get(d.id) ?? "pending" }));
  }

  private async searchModes(businessId: string): Promise<Map<string, "semantic" | "keyword" | "mixed" | "pending">> {
    const out = new Map<string, "semantic" | "keyword" | "mixed" | "pending">();
    try {
      const rows = await this.prisma.client.$queryRawUnsafe<{ documentId: string; total: number; embedded: number }[]>(
        `SELECT "documentId", COUNT(*)::int AS total, COUNT(embedding)::int AS embedded FROM "KnowledgeChunk" WHERE "businessId" = $1 GROUP BY "documentId"`,
        businessId,
      );
      for (const r of rows) out.set(r.documentId, r.total === 0 ? "pending" : r.embedded === 0 ? "keyword" : r.embedded === r.total ? "semantic" : "mixed");
    } catch {
      // informational only
    }
    return out;
  }

  private storageKeyFor(businessId: string, filename: string) {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `tenants/${businessId}/documents/${randomUUID()}-${safeFilename}`;
  }

  async registerFileUpload(businessId: string, filename: string, mimeType: string, buffer: Buffer) {
    const storageKey = this.storageKeyFor(businessId, filename);
    const localPath = join(STORAGE_DIR, storageKey);
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, buffer);

    const document = await this.prisma.client.knowledgeDocument.create({
      data: { businessId, filename, mimeType, sizeBytes: buffer.length, storageKey, source: "upload", status: "uploaded" },
    });
    await this.ingestionQueue.enqueue(document.id, localPath);
    return document;
  }

  async registerTextDocument(businessId: string, filename: string, content: string) {
    return this.registerFileUpload(businessId, filename.endsWith(".txt") ? filename : `${filename}.txt`, "text/plain", Buffer.from(content, "utf-8"));
  }

  async deleteDocument(businessId: string, documentId: string) {
    const doc = await this.prisma.client.knowledgeDocument.findFirst({ where: { id: documentId, businessId } });
    if (!doc) throw new NotFoundException("Document not found");
    await this.prisma.client.knowledgeChunk.deleteMany({ where: { documentId } });
    return this.prisma.client.knowledgeDocument.delete({ where: { id: documentId } });
  }

  async listUnanswered(businessId: string) {
    return this.prisma.client.unansweredQuestion.findMany({
      where: { businessId, status: "open" },
      orderBy: { occurrenceCount: "desc" },
    });
  }

  async resolveUnanswered(businessId: string, questionId: string, resolvedByProfileField: string) {
    const question = await this.prisma.client.unansweredQuestion.findFirst({ where: { id: questionId, businessId } });
    if (!question) throw new NotFoundException("Question not found");
    return this.prisma.client.unansweredQuestion.update({
      where: { id: questionId },
      data: { status: "resolved", resolvedByProfileField, resolvedAt: new Date() },
    });
  }

  async recordUnanswered(businessId: string, conversationId: string, messageId: string, questionText: string) {
    const normalized = questionText.trim().toLowerCase();
    const existing = await this.prisma.client.unansweredQuestion.findFirst({
      where: { businessId, normalizedText: normalized, status: "open" },
    });
    if (existing) {
      return this.prisma.client.unansweredQuestion.update({
        where: { id: existing.id },
        data: { occurrenceCount: { increment: 1 } },
      });
    }
    return this.prisma.client.unansweredQuestion.create({
      data: { businessId, conversationId, messageId, questionText, normalizedText: normalized },
    });
  }
}
