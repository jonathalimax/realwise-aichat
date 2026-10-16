import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import {
  NICHE_SECTIONS,
  normalizePermissions,
  validateRoleDefinition,
  type NicheKey,
  type PermissionSection,
} from "@realwise/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import { MemberAuthService, normalizeEmail, validatePassword } from "../access/member-auth.service";
import { MemberContextService } from "../access/member-context.service";
import type { MemberContext } from "../access/member-context";
import { accessDenied } from "../access/access-errors";
import {
  assertCanGrantRole,
  assertCanModifyMember,
  assertCrfForRole,
  assertNotLastOwner,
  assertRoleEditable,
  hasCrfOnFile,
} from "../access/team-rules";
import { dashboardBasePath, dashboardLink, renderEmailButton } from "../../common/email-links";
import { escapeHtml, sendEmail } from "../../common/email";
import { INVITE_TTL_MS, RESET_TTL_MS, canViewAccessLog, hashToken, memberDto, newToken, permissionSectionsFor, roleChangeSummary, roleDto } from "./team-helpers";

const logger = new Logger("TeamService");

function bad(code: string, message: string, extra: Record<string, unknown> = {}) {
  return new BadRequestException({ statusCode: 400, error: "Bad Request", code, message, ...extra });
}
function conflict(code: string, message: string, extra: Record<string, unknown> = {}) {
  return new ConflictException({ statusCode: 409, error: "Conflict", code, message, ...extra });
}

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
    private readonly memberAuth: MemberAuthService,
    private readonly contexts: MemberContextService,
  ) {}

  // ---------------------------------------------------------------- members

  /** The protected primary Owner: the earliest-created owner member of the business. */
  private async primaryOwnerId(businessId: string): Promise<string | null> {
    const row = await this.prisma.client.businessMember.findFirst({
      where: { businessId, role: { key: "owner" } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async listMembers(businessId: string, opts: { status?: string; q?: string }) {
    const status = opts.status && ["active", "invited", "disabled"].includes(opts.status) ? (opts.status as "active" | "invited" | "disabled") : undefined;
    const q = opts.q?.trim();
    const [rows, grouped, primary] = await Promise.all([
      this.prisma.client.businessMember.findMany({
        where: {
          businessId,
          ...(status ? { status } : {}),
          ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
        },
        include: { role: true },
        orderBy: [{ createdAt: "asc" }],
      }),
      this.prisma.client.businessMember.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }),
      this.primaryOwnerId(businessId),
    ]);
    const counts = { active: 0, invited: 0, disabled: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    return { items: rows.map((m) => memberDto(m, m.id === primary)), counts };
  }

  private async loadMember(businessId: string, id: string) {
    const m = await this.prisma.client.businessMember.findFirst({ where: { id, businessId }, include: { role: true } });
    if (!m) throw new NotFoundException("Membro não encontrado.");
    return m;
  }

  private async loadRole(businessId: string, id: string) {
    const r = await this.prisma.client.role.findFirst({ where: { id, businessId } });
    if (!r) throw new NotFoundException("Função não encontrada.");
    return r;
  }

  private async activeOwnerCount(businessId: string): Promise<number> {
    return this.prisma.client.businessMember.count({ where: { businessId, status: "active", role: { key: "owner" } } });
  }

  private asTarget(m: { id: string; status: "invited" | "active" | "disabled"; role: { key: string | null } }) {
    return { id: m.id, roleKey: m.role.key, status: m.status };
  }

  /** Builds + (best effort) sends an invite email. Returns the link so dev setups without email can use it. */
  private async issueInvite(args: {
    actor: MemberContext;
    member: { id: string; email: string | null; name: string; roleId: string };
    roleName: string;
    kind: "invite" | "password_reset";
  }): Promise<{ url: string | undefined; emailConfigured: boolean }> {
    const { raw, hash } = newToken();
    const email = args.member.email as string;
    await this.prisma.client.$transaction([
      // A new token invalidates every earlier unused one of the same kind.
      this.prisma.client.memberInvite.updateMany({
        where: { memberId: args.member.id, kind: args.kind, acceptedAt: null },
        data: { acceptedAt: new Date(), expiresAt: new Date() },
      }),
      this.prisma.client.memberInvite.create({
        data: {
          businessId: args.actor.businessId,
          memberId: args.member.id,
          email,
          roleId: args.member.roleId,
          tokenHash: hash,
          kind: args.kind,
          expiresAt: new Date(Date.now() + (args.kind === "invite" ? INVITE_TTL_MS : RESET_TTL_MS)),
          invitedByMemberId: args.actor.memberId,
        },
      }),
    ]);
    const biz = await this.prisma.client.business.findUnique({ where: { id: args.actor.businessId }, select: { niche: true } });
    const url = dashboardLink(`${dashboardBasePath(biz?.niche)}/convite/${raw}`);
    return { url, emailConfigured: !!process.env.RESEND_API_KEY };
  }

  async invite(actor: MemberContext, body: { email?: string; name?: string; roleId?: string }) {
    const email = normalizeEmail(body.email);
    const name = (body.name ?? "").trim().slice(0, 100) || email.split("@")[0];
    const role = body.roleId
      ? await this.loadRole(actor.businessId, body.roleId)
      : await this.prisma.client.role.findFirst({ where: { businessId: actor.businessId, key: "attendant" } });
    if (!role) throw bad("ROLE_NOT_FOUND", "Função não encontrada.");
    assertCanGrantRole(actor, role.key);

    const existing = await this.prisma.client.businessMember.findFirst({ where: { businessId: actor.businessId, email } });
    if (existing) throw conflict("EMAIL_IN_USE", "Este e-mail já pertence a um membro da equipe.");

    const member = await this.prisma.client.businessMember.create({
      data: { businessId: actor.businessId, email, name, roleId: role.id, status: "invited" },
      include: { role: true },
    });
    const { url, emailConfigured } = await this.issueInviteAndNotify(actor, member, role.name);
    await this.accessLog.record({
      businessId: actor.businessId,
      actor,
      action: "team.invite",
      target: member.name,
      summary: `Convidou ${member.name} como ${role.name}`,
    });
    return { member: memberDto(member, false), ...(emailConfigured ? {} : { inviteUrl: url }) };
  }

  async resendInvite(actor: MemberContext, memberId: string) {
    const member = await this.loadMember(actor.businessId, memberId);
    if (member.status !== "invited" || !member.email) throw conflict("NOT_INVITED", "Só é possível reenviar convites pendentes.");
    assertCanModifyMember(actor, this.asTarget(member));
    const { url, emailConfigured } = await this.issueInviteAndNotify(actor, member, member.role.name);
    await this.accessLog.record({ businessId: actor.businessId, actor, action: "team.invite_resend", target: member.name, summary: `Reenviou o convite de ${member.name}` });
    return { ok: true as const, ...(emailConfigured ? {} : { inviteUrl: url }) };
  }

  private async issueInviteAndNotify(actor: MemberContext, member: { id: string; email: string | null; name: string; roleId: string }, roleName: string) {
    const result = await this.issueInvite({ actor, member, roleName, kind: "invite" });
    const business = await this.prisma.client.business.findUnique({ where: { id: actor.businessId }, select: { name: true } });
    const link = result.url;
    if (member.email) {
      const html = `<p>Olá, ${escapeHtml(member.name)}.</p><p>${escapeHtml(actor.name)} convidou você para a equipe de <strong>${escapeHtml(business?.name ?? "")}</strong> como <strong>${escapeHtml(roleName)}</strong>.</p>${renderEmailButton("Aceitar convite", link)}<p>O convite vale por 7 dias.</p>`;
      sendEmail(member.email, `Convite para a equipe de ${business?.name ?? "sua farmácia"}`, html).catch(() => {});
    }
    if (!result.emailConfigured) logger.log(`[dev] invite link for ${member.email}: ${link ?? "(DASHBOARD_URL not set)"}`);
    return result;
  }

  async updateMember(actor: MemberContext, memberId: string, body: { name?: string; roleId?: string; crf?: string | null }) {
    const member = await this.loadMember(actor.businessId, memberId);
    assertCanModifyMember(actor, this.asTarget(member));
    const data: { name?: string; roleId?: string; crf?: string | null } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 100) throw bad("INVALID_NAME", "Informe um nome válido.");
      data.name = name;
    }
    if (body.crf !== undefined) {
      const crf = body.crf === null ? null : String(body.crf).trim().slice(0, 40);
      data.crf = crf || null;
    }
    let newRole = member.role;
    if (body.roleId !== undefined && body.roleId !== member.roleId) {
      if (member.id === actor.memberId) throw bad("CANNOT_CHANGE_OWN_ROLE", "Você não pode alterar a sua própria função.");
      newRole = await this.loadRole(actor.businessId, body.roleId);
      assertCanGrantRole(actor, newRole.key);
      assertNotLastOwner(this.asTarget(member), await this.activeOwnerCount(actor.businessId), { type: "role", newRoleKey: newRole.key });
      data.roleId = newRole.id;
    }
    const effectiveCrf = data.crf !== undefined ? data.crf : member.crf;
    if (member.status === "active" && (data.roleId || data.crf !== undefined)) assertCrfForRole(newRole, effectiveCrf);
    const updated = await this.prisma.client.businessMember.update({ where: { id: member.id }, data, include: { role: true } });
    if (data.roleId) {
      await this.accessLog.record({
        businessId: actor.businessId,
        actor,
        action: "team.role_change",
        target: member.name,
        summary: roleChangeSummary(member.name, member.role.name, newRole.name),
      });
    }
    return memberDto(updated, member.id === (await this.primaryOwnerId(actor.businessId)));
  }

  async setDisabled(actor: MemberContext, memberId: string, disabled: boolean) {
    const member = await this.loadMember(actor.businessId, memberId);
    assertCanModifyMember(actor, this.asTarget(member));
    if (disabled) {
      assertNotLastOwner(this.asTarget(member), await this.activeOwnerCount(actor.businessId), { type: "disable" });
      if (member.id === actor.memberId) throw bad("CANNOT_DISABLE_SELF", "Você não pode desativar o seu próprio acesso.");
      if (member.status === "disabled") return memberDto(member, false);
    } else {
      if (member.status !== "disabled") return memberDto(member, false);
      assertCrfForRole(member.role, member.crf);
    }
    const updated = await this.prisma.client.businessMember.update({
      where: { id: member.id },
      // A member that never accepted stays "invited" after re-enable; a disabled active one becomes active again.
      data: { status: disabled ? "disabled" : member.passwordHash || member.phone ? "active" : "invited" },
      include: { role: true },
    });
    await this.accessLog.record({
      businessId: actor.businessId,
      actor,
      action: disabled ? "team.disable" : "team.enable",
      target: member.name,
      summary: `${disabled ? "Desativou" : "Reativou"} ${member.name}`,
    });
    return memberDto(updated, member.id === (await this.primaryOwnerId(actor.businessId)));
  }

  async removeInvited(actor: MemberContext, memberId: string) {
    const member = await this.loadMember(actor.businessId, memberId);
    assertCanModifyMember(actor, this.asTarget(member));
    // A pending invite, or one that was disabled before ever being accepted (no password/phone yet), has no history.
    const neverAccepted = member.status === "invited" || (member.status === "disabled" && !member.passwordHash && !member.phone && !member.lastAccessAt);
    if (!neverAccepted) throw conflict("MEMBER_HAS_HISTORY", "Este membro já tem histórico. Desative o acesso em vez de remover.");
    await this.prisma.client.businessMember.delete({ where: { id: member.id } });
    await this.accessLog.record({ businessId: actor.businessId, actor, action: "team.remove", target: member.name, summary: `Removeu o convite de ${member.name}` });
    return { ok: true as const };
  }

  // ---------------------------------------------------------------- public invite

  private async findLiveToken(raw: string, kind: "invite" | "password_reset") {
    if (typeof raw !== "string" || raw.length < 20 || raw.length > 200) return null;
    const inv = await this.prisma.client.memberInvite.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { role: true, member: true, business: { select: { id: true, name: true, logoUrl: true, niche: true, primaryColor: true, secondaryColor: true, tertiaryColor: true, brandColor: true } } },
    });
    if (!inv || inv.kind !== kind || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) return null;
    return inv;
  }

  async getInvite(token: string) {
    const inv = await this.findLiveToken(token, "invite");
    if (!inv || inv.member.status !== "invited") throw new NotFoundException("Convite não encontrado ou expirado.");
    const { resolveBranding } = await import("@realwise/shared");
    return {
      business: {
        name: inv.business.name,
        logoUrl: inv.business.logoUrl,
        branding: resolveBranding(inv.business.niche as NicheKey, inv.business),
      },
      email: inv.email,
      name: inv.member.name && inv.member.name !== inv.email.split("@")[0] ? inv.member.name : undefined,
      role: { name: inv.role.name, description: inv.role.description, requiresCrf: inv.role.requiresCrf },
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  async acceptInvite(body: { token?: string; name?: string; password?: string; crf?: string; acceptTerms?: boolean }) {
    const inv = await this.findLiveToken(body.token ?? "", "invite");
    if (!inv || inv.member.status !== "invited") throw new NotFoundException("Convite não encontrado ou expirado.");
    if (body.acceptTerms !== true) throw bad("TERMS_REQUIRED", "É preciso aceitar os termos para continuar.");
    const name = (body.name ?? "").trim();
    if (name.length < 2 || name.length > 100) throw bad("INVALID_NAME", "Informe seu nome.");
    validatePassword(body.password);
    const crf = (body.crf ?? "").trim().slice(0, 40) || null;
    assertCrfForRole(inv.role, crf);
    if (inv.role.requiresCrf && !hasCrfOnFile(crf)) throw bad("CRF_REQUIRED_FOR_ROLE", `A função "${inv.role.name}" exige o número do CRF.`);

    const passwordHash = await bcrypt.hash(body.password as string, 10);
    await this.prisma.client.$transaction([
      this.prisma.client.businessMember.update({
        where: { id: inv.memberId },
        data: { name, passwordHash, crf, status: "active", lastAccessAt: new Date() },
      }),
      this.prisma.client.memberInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
    ]);
    const ctx = await this.contexts.resolve({ businessId: inv.businessId, memberId: inv.memberId });
    const token = await this.memberAuth.issueSession(ctx, inv.email);
    await this.accessLog.record({ businessId: inv.businessId, actor: ctx, action: "team.invite_accept", target: name, summary: `${name} aceitou o convite` });
    return { token, me: await this.memberAuth.buildMe(ctx) };
  }

  // ---------------------------------------------------------------- password recovery

  async forgotPassword(email: string, businessSlug?: string): Promise<void> {
    let normalized: string;
    try {
      normalized = normalizeEmail(email);
    } catch {
      return; // never reveal anything
    }
    try {
      const members = await this.prisma.client.businessMember.findMany({
        where: { email: normalized, status: "active", passwordHash: { not: null }, ...(businessSlug ? { business: { slug: businessSlug } } : {}) },
        include: { business: { select: { name: true, niche: true } }, role: true },
      });
      for (const m of members) {
        const { raw, hash } = newToken();
        await this.prisma.client.$transaction([
          this.prisma.client.memberInvite.updateMany({ where: { memberId: m.id, kind: "password_reset", acceptedAt: null }, data: { acceptedAt: new Date(), expiresAt: new Date() } }),
          this.prisma.client.memberInvite.create({
            data: { businessId: m.businessId, memberId: m.id, email: normalized, roleId: m.roleId, tokenHash: hash, kind: "password_reset", expiresAt: new Date(Date.now() + RESET_TTL_MS) },
          }),
        ]);
        const link = dashboardLink(`${dashboardBasePath(m.business.niche)}/redefinir-senha?token=${raw}`);
        const html = `<p>Recebemos um pedido para redefinir a sua senha em <strong>${escapeHtml(m.business.name)}</strong>.</p>${renderEmailButton("Redefinir senha", link)}<p>O link vale por 1 hora. Se não foi você, ignore este e-mail.</p>`;
        sendEmail(normalized, "Redefinição de senha", html).catch(() => {});
        if (!process.env.RESEND_API_KEY) logger.log(`[dev] password reset link for ${normalized}: ${link ?? "(DASHBOARD_URL not set)"}`);
      }
    } catch (err) {
      logger.warn(`forgotPassword failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async resetPassword(body: { token?: string; password?: string }) {
    const inv = await this.findLiveToken(body.token ?? "", "password_reset");
    if (!inv || inv.member.status !== "active") throw new NotFoundException("Link inválido ou expirado.");
    validatePassword(body.password);
    const passwordHash = await bcrypt.hash(body.password as string, 10);
    await this.prisma.client.$transaction([
      this.prisma.client.businessMember.update({ where: { id: inv.memberId }, data: { passwordHash, lastAccessAt: new Date() } }),
      this.prisma.client.memberInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
    ]);
    const ctx = await this.contexts.resolve({ businessId: inv.businessId, memberId: inv.memberId });
    const token = await this.memberAuth.issueSession(ctx, inv.email);
    await this.accessLog.record({ businessId: inv.businessId, actor: ctx, action: "auth.credentials_set", summary: "Redefiniu a senha" });
    return { token, me: await this.memberAuth.buildMe(ctx) };
  }

  // ---------------------------------------------------------------- roles

  async listRoles(businessId: string) {
    const [roles, grouped] = await Promise.all([
      this.prisma.client.role.findMany({ where: { businessId }, orderBy: [{ isStarter: "desc" }, { createdAt: "asc" }] }),
      this.prisma.client.businessMember.groupBy({ by: ["roleId"], where: { businessId }, _count: { _all: true } }),
    ]);
    const counts = new Map(grouped.map((g) => [g.roleId, g._count._all]));
    const order = ["owner", "pharmacist", "manager", "attendant", "courier"];
    roles.sort((a, b) => {
      const ia = a.key ? order.indexOf(a.key) : 99;
      const ib = b.key ? order.indexOf(b.key) : 99;
      return ia - ib || a.createdAt.getTime() - b.createdAt.getTime();
    });
    return { items: roles.map((r) => roleDto(r, counts.get(r.id) ?? 0)) };
  }

  async permissionSections(niche: NicheKey) {
    return { sections: permissionSectionsFor(niche) };
  }

  private validateRoleInput(niche: NicheKey, input: { permissions: unknown; requiresCrf: boolean; ownDeliveriesOnly: boolean }) {
    // A string/array/number grid used to be read as "{}" and silently wiped every permission.
    if (input.permissions !== undefined && input.permissions !== null && (typeof input.permissions !== "object" || Array.isArray(input.permissions))) {
      throw bad("INVALID_ROLE", "Permissões inválidas.", { errors: ["Permissões inválidas."] });
    }
    const errors = validateRoleDefinition({ permissions: input.permissions, requiresCrf: input.requiresCrf, niche });
    if (input.ownDeliveriesOnly && !NICHE_SECTIONS[niche].includes("pedidos" as PermissionSection)) errors.push("Entregas só existem para farmácias.");
    else if (input.ownDeliveriesOnly && normalizePermissions(input.permissions)["pedidos"] === "none") errors.push("\"Somente as próprias entregas\" exige acesso a Pedidos (ver ou editar).");
    if (errors.length) throw bad("INVALID_ROLE", errors[0], { errors });
  }

  async createRole(actor: MemberContext, body: { name?: string; description?: string; requiresCrf?: boolean; permissions?: unknown; ownDeliveriesOnly?: boolean }) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 60) throw bad("INVALID_NAME", "Informe um nome de função (2 a 60 caracteres).");
    const requiresCrf = body.requiresCrf === true;
    const ownDeliveriesOnly = body.ownDeliveriesOnly === true;
    this.validateRoleInput(actor.niche, { permissions: body.permissions, requiresCrf, ownDeliveriesOnly });
    await this.assertRoleNameFree(actor.businessId, name);
    const role = await this.prisma.client.role.create({
      data: {
        businessId: actor.businessId,
        name,
        description: typeof body.description === "string" ? body.description.trim().slice(0, 300) || null : null,
        isStarter: false,
        requiresCrf,
        ownDeliveriesOnly,
        permissions: normalizePermissions(body.permissions) as object,
      },
    });
    await this.accessLog.record({ businessId: actor.businessId, actor, action: "role.create", target: name, summary: `Criou a função ${name}` });
    return roleDto(role, 0);
  }

  private async assertRoleNameFree(businessId: string, name: string, exceptId?: string) {
    const dup = await this.prisma.client.role.findFirst({ where: { businessId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (dup) throw bad("ROLE_NAME_IN_USE", "Já existe uma função com esse nome.");
  }

  async updateRole(actor: MemberContext, id: string, body: { name?: string; description?: string | null; requiresCrf?: boolean; permissions?: unknown; ownDeliveriesOnly?: boolean }) {
    const role = await this.loadRole(actor.businessId, id);
    assertRoleEditable(role, "update");
    if (body.name !== undefined && typeof body.name !== "string") throw bad("INVALID_NAME", "Informe um nome de função (2 a 60 caracteres).");
    const name = body.name !== undefined ? body.name.trim() : role.name;
    if (name.length < 2 || name.length > 60) throw bad("INVALID_NAME", "Informe um nome de função (2 a 60 caracteres).");
    const requiresCrf = body.requiresCrf ?? role.requiresCrf;
    const ownDeliveriesOnly = body.ownDeliveriesOnly ?? role.ownDeliveriesOnly;
    // A partial grid is merged over the stored one (sections left out keep their level) instead of resetting them to "none".
    const permissions =
      body.permissions !== undefined && body.permissions !== null && typeof body.permissions === "object" && !Array.isArray(body.permissions)
        ? { ...normalizePermissions(role.permissions), ...(body.permissions as Record<string, unknown>) }
        : body.permissions !== undefined
          ? body.permissions
          : role.permissions;
    this.validateRoleInput(actor.niche, { permissions, requiresCrf, ownDeliveriesOnly });
    if (name !== role.name) await this.assertRoleNameFree(actor.businessId, name, role.id);
    // Removing the CRF flag from a role whose active members hold it would silently strip pharmacist powers.
    const updated = await this.prisma.client.role.update({
      where: { id },
      data: {
        name,
        ...(body.description !== undefined ? { description: typeof body.description === "string" ? body.description.trim().slice(0, 300) || null : null } : {}),
        requiresCrf,
        ownDeliveriesOnly,
        permissions: normalizePermissions(permissions) as object,
      },
    });
    const memberCount = await this.prisma.client.businessMember.count({ where: { roleId: id } });
    await this.accessLog.record({ businessId: actor.businessId, actor, action: "role.update", target: name, summary: `Atualizou a função ${name}` });
    return roleDto(updated, memberCount);
  }

  async deleteRole(actor: MemberContext, id: string) {
    const role = await this.loadRole(actor.businessId, id);
    assertRoleEditable(role, "delete");
    const inUse = await this.prisma.client.businessMember.count({ where: { roleId: id } });
    if (inUse > 0) throw conflict("ROLE_IN_USE", "Há membros usando esta função. Mude a função deles antes de remover.");
    await this.prisma.client.role.delete({ where: { id } });
    await this.accessLog.record({ businessId: actor.businessId, actor, action: "role.delete", target: role.name, summary: `Removeu a função ${role.name}` });
    return { ok: true as const };
  }

  // ---------------------------------------------------------------- access log

  async listAccessLog(actor: MemberContext, q: { memberId?: string; category?: string; from?: string; to?: string; limit?: string; cursor?: string }) {
    if (!canViewAccessLog(actor.roleKey)) {
      throw accessDenied("PERMISSION_DENIED", "O registro de acessos é visível apenas para proprietários e gerentes.", { section: "equipe", required: "view" });
    }
    const from = q.from ? new Date(q.from) : undefined;
    // A date-only "to" means the whole day (otherwise it silently meant 00:00 and dropped that day's entries).
    const to = q.to ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(q.to) ? `${q.to}T23:59:59.999Z` : q.to) : undefined;
    if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) throw bad("INVALID_DATE", "Data inválida.");
    const res = await this.accessLog.list(actor.businessId, {
      memberId: q.memberId,
      category: q.category,
      from,
      to,
      limit: q.limit && Number.isFinite(Number(q.limit)) ? Math.trunc(Number(q.limit)) : undefined,
      cursor: q.cursor,
    });
    return {
      items: res.items.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        memberId: e.memberId,
        memberName: e.memberName,
        action: e.action,
        category: e.category,
        target: e.target,
        summary: (e.detail as { summary?: string } | null)?.summary ?? e.action,
      })),
      nextCursor: res.nextCursor,
    };
  }
}
