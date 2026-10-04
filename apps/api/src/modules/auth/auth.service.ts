import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { verifyPhoneIdToken, normalizePhone, signBusinessSession, signVisitorSession, signAdminSession } from "@realwise/auth";
import { createHash } from "crypto";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";

const CONSENT_TEXT_VERSION = "2026-01";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async loginBusinessWithFirebaseToken(idToken: string) {
    const { phoneNumber } = await verifyPhoneIdToken(idToken);
    const phone = normalizePhone(phoneNumber);

    let existing = await this.prisma.client.business.findUnique({ where: { phone } });
    let isNew = false;
    if (!existing) {
      try {
        existing = await this.prisma.client.business.create({
          data: {
            phone,
            name: "",
            // Date.now() alone is millisecond-resolution and collided under concurrent signups
            // (the slug is @unique) — a random suffix makes a collision practically impossible.
            slug: `pending-${Date.now()}-${createHash("sha1").update(`${phone}${Math.random()}`).digest("hex").slice(0, 6)}`,
            niche: "imobiliaria",
            ownerName: "",
            status: "onboarding",
            trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          },
        });
        isNew = true;
      } catch (err: any) {
        // Two concurrent signups for the same new phone number raced on the phone unique
        // constraint — the loser just re-reads the winner's row instead of 500ing.
        if (err?.code !== "P2002") throw err;
        existing = await this.prisma.client.business.findUniqueOrThrow({ where: { phone } });
      }
    }
    const business = existing;

    const token = await signBusinessSession({ businessId: business.id, phoneNumber: phone });
    return { token, business, isNew };
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

  async loginAdminWithPassword(email: string, password: string) {
    const admin = await this.prisma.client.adminUser.findUnique({ where: { email: email.toLowerCase().trim() } });
    // Same generic error whether the email doesn't exist or the password is wrong, so a caller
    // can't use the response to enumerate which admin emails are registered.
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    await this.prisma.client.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const token = await signAdminSession({ adminId: admin.id, role: admin.role as "superadmin" | "support" });
    return { token, admin };
  }
}
