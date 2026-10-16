import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Niche } from "@realwise/db";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { PrismaService } from "../../prisma/prisma.service";
import { SharedKnowledgeIngestionQueue } from "../../queues/shared-knowledge-ingestion.queue";

const STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? "./storage";
// Exhaustive: every Niche may have shared knowledge (pharmacy content is curated later).
const NICHE_FLAGS: Record<Niche, true> = { imobiliaria: true, concessionaria: true, farmacia: true };
const ALLOWED_NICHES = Object.keys(NICHE_FLAGS) as Niche[];

// Admin-only CRUD for the shared/global knowledge tier (Stage 2b) — general domain content
// (rental/vehicle law, financing basics, documentation) scoped by niche, not by tenant. Mirrors
// KnowledgeService's structure but writes to SharedKnowledgeDocument/SharedKnowledgeChunk and
// never triggers any tenant-only side effect (confidence recompute, flow-options regenerate,
// listing extraction).
@Injectable()
export class SharedKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestionQueue: SharedKnowledgeIngestionQueue,
  ) {}

  private assertNiche(niche: string) {
    if (!ALLOWED_NICHES.includes(niche as Niche)) {
      throw new BadRequestException(`niche must be one of: ${ALLOWED_NICHES.join(", ")}`);
    }
  }

  async listDocuments(niche?: string) {
    if (niche) this.assertNiche(niche);
    return this.prisma.client.sharedKnowledgeDocument.findMany({
      where: niche ? { niche } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  private storageKeyFor(niche: string, filename: string) {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `shared/${niche}/documents/${randomUUID()}-${safeFilename}`;
  }

  async registerFileUpload(
    niche: string,
    title: string,
    filename: string,
    mimeType: string,
    buffer: Buffer,
    sourceCitation?: string,
    version?: string,
  ) {
    this.assertNiche(niche);
    const storageKey = this.storageKeyFor(niche, filename);
    const localPath = join(STORAGE_DIR, storageKey);
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, buffer);

    const document = await this.prisma.client.sharedKnowledgeDocument.create({
      data: {
        niche,
        title,
        filename,
        mimeType,
        sizeBytes: buffer.length,
        storageKey,
        source: "upload",
        status: "uploaded",
        sourceCitation,
        version,
      },
    });
    await this.ingestionQueue.enqueue(document.id, localPath);
    return document;
  }

  async registerTextDocument(
    niche: string,
    title: string,
    filename: string,
    content: string,
    sourceCitation?: string,
    version?: string,
  ) {
    return this.registerFileUpload(
      niche,
      title,
      filename.endsWith(".txt") ? filename : `${filename}.txt`,
      "text/plain",
      Buffer.from(content, "utf-8"),
      sourceCitation,
      version,
    );
  }

  async deactivateDocument(documentId: string) {
    const doc = await this.prisma.client.sharedKnowledgeDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException("Shared knowledge document not found");
    return this.prisma.client.sharedKnowledgeDocument.update({
      where: { id: documentId },
      data: { isActive: false },
    });
  }

  async reactivateDocument(documentId: string) {
    const doc = await this.prisma.client.sharedKnowledgeDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException("Shared knowledge document not found");
    return this.prisma.client.sharedKnowledgeDocument.update({
      where: { id: documentId },
      data: { isActive: true, reviewedAt: new Date() },
    });
  }

  async deleteDocument(documentId: string) {
    const doc = await this.prisma.client.sharedKnowledgeDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException("Shared knowledge document not found");
    await this.prisma.client.sharedKnowledgeChunk.deleteMany({ where: { documentId } });
    return this.prisma.client.sharedKnowledgeDocument.delete({ where: { id: documentId } });
  }
}
