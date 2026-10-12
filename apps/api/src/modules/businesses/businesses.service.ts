import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { assertPublicHttpUrl } from "../../common/url-safety";
import { isEffectivelySuspended } from "@realwise/shared";

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
        trialEndsAt: true,
        subscription: { select: { status: true } },
      },
    });
    if (!business || business.status !== "live" || isEffectivelySuspended(business)) {
      throw new NotFoundException("Business not published");
    }
    // Fire-and-forget: every real page load of the public chat link counts as a link open,
    // feeding the "Aberturas do link 7d" dashboard stat. Never block the chat on this.
    this.prisma.client.analyticsEvent.create({ data: { businessId: business.id, name: "link_opened" } }).catch(() => {});
    const { trialEndsAt, subscription, ...publicBusiness } = business;
    return publicBusiness;
  }

  async getOwnBusiness(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!business) throw new NotFoundException("Business not found");
    // Belt-and-suspenders: don't wait for the daily trial-watch cron to flip status before gating.
    if (business.status === "live" && isEffectivelySuspended(business)) {
      return { ...business, status: "suspended" as const };
    }
    return business;
  }

  async updateProfile(
    businessId: string,
    data: {
      name?: string;
      ownerName?: string;
      email?: string;
      niche?: "imobiliaria" | "concessionaria";
      timezone?: string;
      address?: string;
      websiteUrl?: string;
      financingRatePercent?: number | null;
    },
  ) {
    if (data.financingRatePercent != null) {
      if (!Number.isFinite(data.financingRatePercent) || data.financingRatePercent <= 0 || data.financingRatePercent > 20) {
        throw new BadRequestException("Taxa de juros inválida");
      }
    }
    if (data.websiteUrl !== undefined && data.websiteUrl !== "") {
      // Website sync was originally a "studio" plan exclusive — automatic site ingestion is the
      // product's core differentiator and must be available on every paying tier, so it is not
      // plan-gated.
      try {
        await assertPublicHttpUrl(data.websiteUrl);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "URL do site inválida");
      }
    }
    return this.prisma.client.business.update({ where: { id: businessId }, data });
  }

  async isSlugAvailable(slug: string) {
    const existing = await this.prisma.client.business.findUnique({ where: { slug } });
    return !existing;
  }

  async setSlug(businessId: string, slug: string) {
    const existing = await this.prisma.client.business.findUnique({ where: { slug } });
    if (existing && existing.id !== businessId) {
      throw new BadRequestException("Slug already taken");
    }
    try {
      return await this.prisma.client.business.update({ where: { id: businessId }, data: { slug } });
    } catch (err: any) {
      // Belt-and-suspenders for the check-then-update race the findUnique above can't fully close.
      if (err?.code === "P2002") throw new BadRequestException("Slug already taken");
      throw err;
    }
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

  // Only digits (with an optional leading +) — rejects stray formatting characters like a bare
  // "(1" slipping through if the client-side mask ever fails to normalize the input.
  private assertValidPhone(phone: string) {
    const digitsOnly = phone.replace(/^\+/, "");
    if (!/^\d{10,15}$/.test(digitsOnly)) {
      throw new BadRequestException("Número inválido — use apenas dígitos (DDD + número).");
    }
  }

  async addWhatsappNumber(businessId: string, label: string, phone: string) {
    this.assertValidPhone(phone);
    const count = await this.prisma.client.whatsappRoutingNumber.count({ where: { businessId } });
    return this.prisma.client.whatsappRoutingNumber.create({
      data: { businessId, label, phone, priority: count },
    });
  }

  async updateWhatsappNumber(businessId: string, numberId: string, label: string, phone: string) {
    this.assertValidPhone(phone);
    const number = await this.prisma.client.whatsappRoutingNumber.findFirst({ where: { id: numberId, businessId } });
    if (!number) throw new NotFoundException("Number not found");
    return this.prisma.client.whatsappRoutingNumber.update({ where: { id: numberId }, data: { label, phone } });
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
