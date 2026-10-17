import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import type { NicheKey } from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { StarterRolesService } from "../access/starter-roles.service";
import { normalizeEmail } from "../access/member-auth.service";
import { dashboardBasePath, dashboardLink, renderEmailButton } from "../../common/email-links";
import { escapeHtml, sendEmail } from "../../common/email";
import { newToken, INVITE_TTL_MS } from "../team/team-helpers";
import { getPersona } from "../chat/personas";

const logger = new Logger("AdminOnboarding");
const NICHES: NicheKey[] = ["imobiliaria", "farmacia", "concessionaria"];
const TRIAL_DAYS = 7;

function bad(code: string, message: string) {
  return new BadRequestException({ statusCode: 400, error: "Bad Request", code, message });
}

const NICHE_LABEL: Record<NicheKey, string> = { imobiliaria: "imobiliária", farmacia: "farmácia", concessionaria: "concessionária" };

/**
 * Admin-created customers: the platform admin creates the business and the owner receives an e-mail with a
 * link to choose a password (no phone / SMS involved). Reuses the team invite machinery (MemberInvite + /convite/<token>).
 * For businesses that already exist (signed up by phone) the same e-mail carries a password-setup link instead.
 */
@Injectable()
export class AdminOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly starterRoles: StarterRolesService,
  ) {}

  async createBusiness(body: { niche?: string; businessName?: string; ownerName?: string; email?: string; trialDays?: number }) {
    const niche = body.niche as NicheKey;
    if (!NICHES.includes(niche)) throw bad("INVALID_NICHE", "Escolha o tipo de negócio.");
    const businessName = (body.businessName ?? "").trim().slice(0, 120);
    const ownerName = (body.ownerName ?? "").trim().slice(0, 100);
    if (businessName.length < 2) throw bad("INVALID_NAME", "Informe o nome do negócio.");
    if (ownerName.length < 2) throw bad("INVALID_OWNER", "Informe o nome do responsável.");
    let email: string;
    try {
      email = normalizeEmail(body.email);
    } catch {
      throw bad("INVALID_EMAIL", "E-mail inválido.");
    }
    const taken = await this.prisma.client.businessMember.findFirst({ where: { email, role: { key: "owner" } }, select: { id: true } });
    if (taken) throw new ConflictException({ statusCode: 409, error: "Conflict", code: "EMAIL_IN_USE", message: "Este e-mail já é proprietário de outro negócio." });
    const trialDays = Number.isInteger(body.trialDays) && (body.trialDays as number) >= 0 && (body.trialDays as number) <= 90 ? (body.trialDays as number) : TRIAL_DAYS;

    const business = await this.prisma.client.business.create({
      data: {
        phone: null,
        name: businessName,
        slug: `pending-${Date.now()}-${createHash("sha1").update(`${email}${Math.random()}`).digest("hex").slice(0, 6)}`,
        niche,
        ownerName,
        email,
        status: "onboarding",
        trialEndsAt: new Date(Date.now() + trialDays * 24 * 3600 * 1000),
      },
    });
    await this.starterRoles.ensureRolesOnly(business.id, niche);
    const ownerRole = await this.prisma.client.role.findUniqueOrThrow({ where: { businessId_key: { businessId: business.id, key: "owner" } } });
    const member = await this.prisma.client.businessMember.create({
      data: { businessId: business.id, email, name: ownerName, roleId: ownerRole.id, status: "invited" },
    });
    const result = await this.issueAccessLink({ businessId: business.id, memberId: member.id, roleId: ownerRole.id, email, kind: "invite" });
    await this.notify({ niche, businessName, ownerName, email, url: result.url, kind: "invite" });
    logger.log(`admin created ${niche} business ${business.id} (owner invited)`);
    return { business: { id: business.id, name: businessName, niche, status: business.status }, ...(result.emailConfigured ? {} : { inviteUrl: result.url }) };
  }

  /** Re-sends the access e-mail: invite for a pending owner, password-setup link for an owner without a password. */
  async sendOwnerAccess(businessId: string, newEmail?: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, niche: true, ownerName: true, email: true } });
    if (!business) throw new NotFoundException("Cliente não encontrado.");
    const owner = await this.prisma.client.businessMember.findFirst({ where: { businessId, role: { key: "owner" } }, orderBy: { createdAt: "asc" }, include: { role: true } });
    if (!owner) throw new NotFoundException("Este cliente ainda não tem um proprietário cadastrado.");
    let email = owner.email;
    if (newEmail) {
      try {
        email = normalizeEmail(newEmail);
      } catch {
        throw bad("INVALID_EMAIL", "E-mail inválido.");
      }
    }
    if (!email) throw bad("EMAIL_REQUIRED", "Informe o e-mail do proprietário.");
    if (email !== owner.email) {
      const clash = await this.prisma.client.businessMember.findFirst({ where: { businessId, email, id: { not: owner.id } }, select: { id: true } });
      if (clash) throw new ConflictException({ statusCode: 409, error: "Conflict", code: "EMAIL_IN_USE", message: "Este e-mail já pertence a outro membro deste negócio." });
      await this.prisma.client.businessMember.update({ where: { id: owner.id }, data: { email } });
      if (!business.email) await this.prisma.client.business.update({ where: { id: businessId }, data: { email } });
    }
    const kind = owner.status === "invited" ? "invite" : "password_reset";
    const result = await this.issueAccessLink({ businessId, memberId: owner.id, roleId: owner.roleId, email, kind });
    await this.notify({ niche: business.niche as NicheKey, businessName: business.name || "seu negócio", ownerName: owner.name, email, url: result.url, kind });
    return { ok: true as const, email, kind, ...(result.emailConfigured ? {} : { url: result.url }) };
  }

  private async issueAccessLink(args: { businessId: string; memberId: string; roleId: string; email: string; kind: "invite" | "password_reset" }) {
    const { raw, hash } = newToken();
    await this.prisma.client.$transaction([
      this.prisma.client.memberInvite.updateMany({ where: { memberId: args.memberId, kind: args.kind, acceptedAt: null }, data: { acceptedAt: new Date(), expiresAt: new Date() } }),
      this.prisma.client.memberInvite.create({
        data: { businessId: args.businessId, memberId: args.memberId, email: args.email, roleId: args.roleId, tokenHash: hash, kind: args.kind, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      }),
    ]);
    const biz = await this.prisma.client.business.findUnique({ where: { id: args.businessId }, select: { niche: true } });
    const path = args.kind === "invite" ? `/convite/${raw}` : `/redefinir-senha?token=${raw}`;
    return { url: dashboardLink(`${dashboardBasePath(biz?.niche)}${path}`), emailConfigured: !!process.env.RESEND_API_KEY };
  }

  private async notify(a: { niche: NicheKey; businessName: string; ownerName: string; email: string; url: string | undefined; kind: "invite" | "password_reset" }) {
    const persona = getPersona(a.niche).name;
    const what = a.kind === "invite" ? "Crie sua senha para acessar o painel" : "Crie sua senha para acessar o painel com e-mail e senha";
    const html =
      `<p>Olá, ${escapeHtml(a.ownerName)}.</p>` +
      `<p>A conta da sua ${NICHE_LABEL[a.niche]}, <strong>${escapeHtml(a.businessName)}</strong>, está pronta na Realwise. ${escapeHtml(persona)} vai atender seus clientes assim que você terminar a configuração.</p>` +
      renderEmailButton(what, a.url) +
      `<p>O link vale por 7 dias. Se ele expirar, peça um novo à nossa equipe.</p>`;
    sendEmail(a.email, `Seu acesso à Realwise — ${a.businessName}`, html).catch(() => {});
    if (!process.env.RESEND_API_KEY) logger.log(`[dev] access link for ${a.email}: ${a.url ?? "(DASHBOARD_URL not set)"}`);
  }
}
