import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async listDocuments(businessId: string) {
    return this.prisma.client.knowledgeDocument.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
  }

  async registerUpload(businessId: string, filename: string, mimeType: string, sizeBytes: number) {
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = `tenants/${businessId}/documents/${randomUUID()}-${safeFilename}`;
    return this.prisma.client.knowledgeDocument.create({
      data: { businessId, filename, mimeType, sizeBytes, storageKey, source: "upload", status: "uploaded" },
    });
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
