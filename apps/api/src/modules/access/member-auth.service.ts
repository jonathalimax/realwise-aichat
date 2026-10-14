import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { signBusinessSession } from "@realwise/auth";
import {
  isValidHexColor,
  resolveBranding,
  visibleSections,
  type NicheKey,
} from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { loadOperationMode } from "../pharmacy-common/operation-mode";
import { AccessLogService } from "./access-log.service";
import { MemberContextService } from "./member-context.service";
import type { MemberContext } from "./member-context";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD_LENGTH = 8;
// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = "$2b$10$eMejrY8dx.zaIEbjwyvAPOKnDORqYEp6VslI3jNK18pviE1z1ebSy";

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    throw new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      code: "WEAK_PASSWORD",
      message: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    });
  }
  return password;
}

export function normalizeEmail(email: unknown): string {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!e || e.length > 254 || !EMAIL_PATTERN.test(e)) {
    throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "INVALID_EMAIL", message: "E-mail inválido." });
  }
  return e;
}

@Injectable()
export class MemberAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contexts: MemberContextService,
    private readonly accessLog: AccessLogService,
  ) {}

  /** Session JWT for a resolved member (used by every login path). */
  async issueSession(ctx: MemberContext, phoneNumber: string): Promise<string> {
    return signBusinessSession({
      businessId: ctx.businessId,
      phoneNumber,
      memberId: ctx.memberId,
      roleId: ctx.roleId,
      roleKey: ctx.roleKey,
      permissions: ctx.permissions,
    });
  }

  /**
   * Email + password login for business members. `businessSlug` is optional and only needed when
   * the same email + password exists in several businesses (then 409 BUSINESS_AMBIGUOUS with choices).
   */
  async loginWithPassword(email: string, password: string, businessSlug?: string) {
    const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalized || typeof password !== "string" || !password) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const candidates = await this.prisma.client.businessMember.findMany({
      where: {
        email: normalized,
        status: "active",
        passwordHash: { not: null },
        ...(businessSlug ? { business: { slug: businessSlug } } : {}),
      },
      include: { role: true, business: true },
    });
    if (candidates.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedException("Invalid email or password");
    }
    const matches: typeof candidates = [];
    for (const c of candidates) {
      if (c.passwordHash && (await bcrypt.compare(password, c.passwordHash))) matches.push(c);
    }
    if (matches.length === 0) throw new UnauthorizedException("Invalid email or password");
    if (matches.length > 1) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: "BUSINESS_AMBIGUOUS",
        message: "Este e-mail está em mais de um negócio. Informe qual.",
        businesses: matches.map((m) => ({ slug: m.business.slug, name: m.business.name })),
      });
    }
    const member = matches[0];
    await this.prisma.client.businessMember.update({ where: { id: member.id }, data: { lastAccessAt: new Date() } });
    const ctx = this.contexts.toContext(member);
    const token = await this.issueSession(ctx, member.email ?? member.phone ?? member.id);
    await this.accessLog.record({ businessId: member.businessId, actor: ctx, action: "auth.login" });
    return { token, ctx };
  }

  /** Phone (Firebase) owner login: resolve / create the Owner member and return a member-aware session. */
  async sessionForPhoneOwner(business: { id: string; phone: string }) {
    const ctx = await this.contexts.resolve({ businessId: business.id, phoneNumber: business.phone });
    const token = await this.issueSession(ctx, business.phone);
    return { token, ctx };
  }

  /**
   * Let the logged-in member set / change their own email + password (owners who so far only had
   * phone login use this to be able to sign in with email).
   */
  async setOwnCredentials(ctx: MemberContext, email: string, password: string, currentPassword?: string) {
    const normalized = normalizeEmail(email);
    validatePassword(password);
    const row = await this.prisma.client.businessMember.findUniqueOrThrow({ where: { id: ctx.memberId } });
    if (row.passwordHash) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, row.passwordHash))) {
        throw new UnauthorizedException({ statusCode: 401, error: "Unauthorized", code: "CURRENT_PASSWORD_INVALID", message: "Senha atual incorreta." });
      }
    }
    try {
      await this.prisma.client.businessMember.update({
        where: { id: ctx.memberId },
        data: { email: normalized, passwordHash: await bcrypt.hash(password, 10) },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new ConflictException({ statusCode: 409, error: "Conflict", code: "EMAIL_IN_USE", message: "Este e-mail já é usado por outro membro." });
      }
      throw err;
    }
    await this.accessLog.record({ businessId: ctx.businessId, actor: ctx, action: "auth.credentials_set" });
    return { ok: true };
  }

  /** Payload of GET /auth/me. Permissions are always freshly resolved. */
  async buildMe(ctx: MemberContext) {
    const business = await this.prisma.client.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { id: true, name: true, slug: true, niche: true, status: true, logoUrl: true, primaryColor: true, secondaryColor: true, tertiaryColor: true, brandColor: true },
    });
    const niche = business.niche as NicheKey;
    const operationMode = niche === "farmacia" ? await loadOperationMode(this.prisma.client, business.id) : null;
    // Attendance mode hides the commerce sections (the API refuses them too).
    const COMMERCE_SECTIONS = ["pedidos", "receitas", "catalogo", "importar", "classes"];
    const sections = visibleSections(ctx.permissions, niche).filter((sec) => operationMode?.effective !== "attendance" || !COMMERCE_SECTIONS.includes(sec));
    return {
      member: { id: ctx.memberId, name: ctx.name, email: ctx.email, crf: ctx.crf },
      role: {
        id: ctx.roleId,
        key: ctx.roleKey,
        name: ctx.roleName,
        requiresCrf: ctx.requiresCrf,
        ownDeliveriesOnly: ctx.ownDeliveriesOnly,
      },
      permissions: ctx.permissions,
      visibleSections: sections,
      canPerformPharmacistActions: ctx.requiresCrf && !!ctx.crf && ctx.crf.trim().length >= 3,
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        niche,
        status: business.status,
        logoUrl: business.logoUrl,
        branding: resolveBranding(niche, business),
        brandingIsCustom: [business.primaryColor, business.secondaryColor, business.tertiaryColor].some(isValidHexColor),
        // Pharmacy only: chosen + effective operation mode and whether the plan allows commerce (null for other niches).
        operationMode,
      },
    };
  }
}
