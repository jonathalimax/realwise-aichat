import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { assertPublicHttpUrl } from "../../common/url-safety";
import { isEffectivelySuspended, isValidHexColor, resolveBranding, type NicheKey } from "@realwise/shared";
import { StarterRolesService } from "../access/starter-roles.service";

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly starterRoles: StarterRolesService,
  ) {}

  async getBySlug(slug: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        niche: true,
        logoUrl: true,
        brandColor: true,
        primaryColor: true,
        secondaryColor: true,
        tertiaryColor: true,
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
    const { trialEndsAt, subscription, primaryColor, secondaryColor, tertiaryColor, ...publicBusiness } = business;
    // `branding` is always fully resolved (niche default when unset): the chat widget can apply it as-is.
    return { ...publicBusiness, branding: resolveBranding(business.niche as NicheKey, { primaryColor, secondaryColor, tertiaryColor, brandColor: business.brandColor }) };
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
      niche?: NicheKey;
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
    const updated = await this.prisma.client.business.update({ where: { id: businessId }, data });
    // Niche is picked during onboarding after the business (and its starter roles) already exist:
    // re-sync so e.g. a pharmacy gets the pharmacist / courier roles and the pharmacy grids.
    if (data.niche) await this.starterRoles.syncForNiche(businessId, data.niche);
    return updated;
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

  /** Branding with the niche default resolved; `*Stored` fields are the raw (nullable) values. */
  async getBranding(businessId: string) {
    const b = await this.prisma.client.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { niche: true, logoUrl: true, brandColor: true, primaryColor: true, secondaryColor: true, tertiaryColor: true },
    });
    const niche = b.niche as NicheKey;
    return {
      logoUrl: b.logoUrl,
      ...resolveBranding(niche, b),
      stored: { primaryColor: b.primaryColor, secondaryColor: b.secondaryColor, tertiaryColor: b.tertiaryColor },
      isCustom: [b.primaryColor, b.secondaryColor, b.tertiaryColor].some(isValidHexColor),
    };
  }

  /**
   * Whitelisted (this used to pass the raw body to Prisma). Colours must be #RRGGBB or null (= reset to
   * the niche default). `brandColor` is the legacy single colour and is kept in sync with the primary.
   */
  async updateBranding(
    businessId: string,
    body: { logoUrl?: string | null; brandColor?: string | null; primaryColor?: string | null; secondaryColor?: string | null; tertiaryColor?: string | null },
  ) {
    const data: Record<string, string | null> = {};
    for (const key of ["primaryColor", "secondaryColor", "tertiaryColor", "brandColor"] as const) {
      const v = body[key];
      if (v === undefined) continue;
      if (v !== null && !isValidHexColor(v)) throw new BadRequestException(`Cor inválida em ${key} (use #RRGGBB).`);
      data[key] = v;
    }
    if (body.logoUrl !== undefined) {
      if (body.logoUrl && (body.logoUrl.length > 2048 || !/^(https?:\/\/|\/)/i.test(body.logoUrl))) {
        throw new BadRequestException("URL do logo inválida");
      }
      data.logoUrl = body.logoUrl || null;
    }
    if (data.primaryColor !== undefined && data.brandColor === undefined) data.brandColor = data.primaryColor;
    await this.prisma.client.business.update({ where: { id: businessId }, data });
    return this.getBranding(businessId);
  }
}
