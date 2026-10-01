import { Injectable, NotFoundException } from "@nestjs/common";
import { verifyPhoneIdToken, normalizePhone, signBusinessSession, signVisitorSession } from "@realwise/auth";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async loginBusinessWithFirebaseToken(idToken: string) {
    const { phoneNumber } = await verifyPhoneIdToken(idToken);
    const phone = normalizePhone(phoneNumber);

    const business = await this.prisma.client.business.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        name: "",
        slug: `pending-${Date.now()}`,
        niche: "imobiliaria",
        ownerName: "",
        status: "onboarding",
      },
    });

    const token = await signBusinessSession({ businessId: business.id, phoneNumber: phone });
    return { token, business };
  }

  async identifyVisitor(businessSlug: string, name: string, phone: string) {
    const business = await this.prisma.client.business.findUnique({ where: { slug: businessSlug } });
    if (!business) throw new NotFoundException("Business not found");

    const phoneNormalized = normalizePhone(phone);
    const lead = await this.prisma.client.lead.upsert({
      where: { businessId_phoneNormalized: { businessId: business.id, phoneNormalized } },
      update: { name, lastSeenAt: new Date(), sessionCount: { increment: 1 } },
      create: { businessId: business.id, name, phone, phoneNormalized },
    });

    const token = await signVisitorSession({ businessId: business.id, leadId: lead.id, phoneNumber: phoneNormalized, name });
    return { token, lead };
  }
}
