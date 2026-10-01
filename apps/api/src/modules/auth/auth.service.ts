import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { verifyPhoneIdToken, normalizePhone, signBusinessSession, signVisitorSession, signAdminSession } from "@realwise/auth";
import { createHash } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";

const CONSENT_TEXT_VERSION = "2026-01";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async loginBusinessWithFirebaseToken(idToken: string) {
    const { phoneNumber } = await verifyPhoneIdToken(idToken);
    const phone = normalizePhone(phoneNumber);

    const existing = await this.prisma.client.business.findUnique({ where: { phone } });
    const business =
      existing ??
      (await this.prisma.client.business.create({
        data: {
          phone,
          name: "",
          slug: `pending-${Date.now()}`,
          niche: "imobiliaria",
          ownerName: "",
          status: "onboarding",
          trialEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      }));

    const token = await signBusinessSession({ businessId: business.id, phoneNumber: phone });
    return { token, business, isNew: !existing };
  }

  async identifyVisitor(businessSlug: string, name: string, phone: string, ip: string, userAgent: string, anonVisitorToken?: string) {
    const business = await this.prisma.client.business.findUnique({ where: { slug: businessSlug } });
    if (!business) throw new NotFoundException("Business not found");

    const phoneNormalized = normalizePhone(phone);
    // Phone is not OTP-verified here (low-friction-by-design, see plan §14.4) — so on a match
    // against an existing lead we only bump recency, never overwrite the name an attacker could
    // spoof by typing someone else's number.
    const existingLead = await this.prisma.client.lead.findUnique({
      where: { businessId_phoneNormalized: { businessId: business.id, phoneNormalized } },
    });
    const lead = existingLead
      ? await this.prisma.client.lead.update({
          where: { id: existingLead.id },
          data: { lastSeenAt: new Date(), sessionCount: { increment: 1 } },
        })
      : await this.prisma.client.lead.create({
          data: { businessId: business.id, name, phone, phoneNormalized },
        });

    await this.prisma.client.consentRecord.create({
      data: {
        businessId: business.id,
        leadId: lead.id,
        phoneHash: createHash("sha256").update(phoneNormalized).digest("hex"),
        consentTextVersion: CONSENT_TEXT_VERSION,
        purposes: ["atendimento", "agendamento"],
        ipAddress: ip,
        userAgent,
      },
    });

    if (anonVisitorToken) {
      await this.prisma.client.conversation.updateMany({
        where: { businessId: business.id, visitorToken: anonVisitorToken, leadId: null },
        data: { leadId: lead.id },
      });
    }

    const token = await signVisitorSession({ businessId: business.id, leadId: lead.id, phoneNumber: phoneNormalized, name });
    return { token, lead };
  }

  async loginAdminWithFirebaseToken(idToken: string) {
    const { phoneNumber } = await verifyPhoneIdToken(idToken);
    const phone = normalizePhone(phoneNumber);

    const admin = await this.prisma.client.adminUser.findUnique({ where: { phone } });
    if (!admin) throw new UnauthorizedException("This phone number is not registered as an admin");

    await this.prisma.client.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const token = await signAdminSession({ adminId: admin.id, role: admin.role as "superadmin" | "support" });
    return { token, admin };
  }
}
