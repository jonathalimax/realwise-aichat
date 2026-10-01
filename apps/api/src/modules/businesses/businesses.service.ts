import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async getBySlug(slug: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        niche: true,
        logoUrl: true,
        brandColor: true,
        status: true,
      },
    });
    if (!business || business.status !== "live") {
      throw new NotFoundException("Business not published");
    }
    return business;
  }

  async getOwnBusiness(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    return business;
  }

  async updateProfile(businessId: string, data: { name?: string; ownerName?: string; niche?: "imobiliaria" | "concessionaria"; timezone?: string; address?: string }) {
    return this.prisma.client.business.update({ where: { id: businessId }, data });
  }

  async isSlugAvailable(slug: string) {
    const existing = await this.prisma.client.business.findUnique({ where: { slug } });
    return !existing;
  }

  async publish(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException("Business not found");
    if (business.confidenceScore < 70) {
      throw new Error("Confidence score below publish threshold (70)");
    }
    return this.prisma.client.business.update({
      where: { id: businessId },
      data: { status: "live", publishedAt: new Date() },
    });
  }

  async confirmLinkPlaced(businessId: string) {
    return this.prisma.client.business.update({ where: { id: businessId }, data: { linkPlacedAt: new Date() } });
  }

  async listWhatsappNumbers(businessId: string) {
    return this.prisma.client.whatsappRoutingNumber.findMany({ where: { businessId }, orderBy: { priority: "asc" } });
  }

  async addWhatsappNumber(businessId: string, label: string, phone: string) {
    const count = await this.prisma.client.whatsappRoutingNumber.count({ where: { businessId } });
    return this.prisma.client.whatsappRoutingNumber.create({
      data: { businessId, label, phone, priority: count },
    });
  }

  async removeWhatsappNumber(businessId: string, numberId: string) {
    const number = await this.prisma.client.whatsappRoutingNumber.findFirst({ where: { id: numberId, businessId } });
    if (!number) throw new NotFoundException("Number not found");
    return this.prisma.client.whatsappRoutingNumber.delete({ where: { id: numberId } });
  }

  async updateBranding(businessId: string, data: { logoUrl?: string; brandColor?: string }) {
    return this.prisma.client.business.update({ where: { id: businessId }, data });
  }
}
