import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { farmaciaSettingsFieldMap } from "@realwise/profile-schema";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import { accessDenied } from "../access/access-errors";
import { ensureSettingsRow } from "../pharmacy-common/counters";
import { fold } from "../pharmacy-common/format";
import { commerceBlocked, loadOperationMode } from "../pharmacy-common/operation-mode";
import { sheetStatus } from "../pharmacy-common/sheet";
import { PROPOSAL_LABELS, parseProposal } from "./proposals";
import { IDENTITY_KEYS, buildSettingsPatch, settingsSummary } from "./settings-validation";

export const BANNER = "Notificações de pedidos estão sempre ativas.";

const SETTINGS_KEYS = [
  "legalName", "cnpj", "afeNumber", "pharmacistName", "pharmacistCrf",
  "deliveryEnabled", "deliveryFeeCents", "minOrderCents", "deliveryAreas", "pickupEnabled",
  "maxQtyPerItemDefault", "autoConfirmEnabled", "stockMaxAgeHours", "openingHours", "paymentMethods",
  "exchangePolicy", "prescriptionRetentionDays", "orderReminderMinutes", "quickChips", "operationMode", "operationModeChosenAt",
] as const;

type ProposalRecord = {
  fieldKey: string;
  label: string;
  rawAnswer: string;
  proposed: Record<string, unknown>;
  status: "pending" | "confirmed" | "dismissed";
  proposedAt: string;
  confirmedAt: string | null;
  matchedProducts?: Array<{ id: string; name: string }>;
};

@Injectable()
export class PharmacySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
  ) {}

  /** Create-on-read. */
  async getRow(businessId: string) {
    await ensureSettingsRow(this.prisma.client as any, businessId);
    return this.prisma.client.pharmacySettings.findUniqueOrThrow({ where: { businessId } });
  }

  async latestSheet(businessId: string, maxAgeHours: number) {
    const imp = await this.prisma.client.catalogImport.findFirst({
      where: { businessId, status: "applied", stockAsOf: { not: null } },
      orderBy: { stockAsOf: "desc" },
      select: { stockAsOf: true },
    });
    return sheetStatus(imp?.stockAsOf ?? null, maxAgeHours);
  }

  async dto(businessId: string) {
    const row = await this.getRow(businessId);
    const settings: Record<string, unknown> = {};
    for (const k of SETTINGS_KEYS) settings[k] = (row as any)[k];
    const proposals = await this.proposalsDto(businessId, (row.proposals ?? {}) as Record<string, ProposalRecord>);
    const sheet = await this.latestSheet(businessId, row.stockMaxAgeHours);
    // Chosen mode + plan = effective mode (commerce needs the plan feature `pharmacyCommerce`).
    const mode = await loadOperationMode(this.prisma.client, businessId);
    return {
      settings,
      mode,
      proposals,
      sheet: { stockAsOf: sheet.asOf, ageHours: sheet.ageHours, maxAgeHours: sheet.maxAgeHours, stale: sheet.stale },
      banner: BANNER,
    };
  }

  private async proposalsDto(businessId: string, raw: Record<string, ProposalRecord>) {
    const entries = Object.values(raw).filter((p) => p && p.fieldKey);
    // pending first, then newest
    entries.sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.proposedAt.localeCompare(a.proposedAt));
    const out: Record<string, ProposalRecord> = {};
    for (const p of entries) {
      const names = p.proposed?.pharmacistRequiredProductNames;
      out[p.fieldKey] = {
        ...p,
        ...(Array.isArray(names) && p.status === "pending" ? { matchedProducts: await this.matchProductsByName(businessId, names as string[]) } : {}),
      };
    }
    return out;
  }

  /** Matches interview product names against the catalog (folded, contains either way). */
  async matchProductsByName(businessId: string, names: string[]): Promise<Array<{ id: string; name: string }>> {
    const wanted = names.map(fold).filter((n) => n.length >= 3);
    if (!wanted.length) return [];
    const products = await this.prisma.client.product.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true }, take: 20000 });
    return products.filter((p) => {
      const f = fold(p.name);
      return wanted.some((w) => f.includes(w) || (f.length >= 4 && w.includes(f)));
    }).slice(0, 200);
  }

  async update(actor: MemberContext, patch: Record<string, unknown>) {
    const row = await this.getRow(actor.businessId);
    const { data, changedKeys } = buildSettingsPatch(row as unknown as Record<string, unknown>, patch ?? {});
    if (changedKeys.some((k) => (IDENTITY_KEYS as readonly string[]).includes(k)) && actor.roleKey !== "owner") {
      throw accessDenied("OWNER_PROTECTED", "Identidade legal só para proprietário.");
    }
    const modeExtra = await this.operationModeRules(actor, row as unknown as Record<string, unknown>, data, changedKeys, "operationMode" in (patch ?? {}));
    if (changedKeys.length > 0 || Object.keys(modeExtra).length > 0) {
      const toWrite = { ...Object.fromEntries(changedKeys.map((k) => [k, data[k]])), ...modeExtra };
      await this.prisma.client.pharmacySettings.update({ where: { businessId: actor.businessId }, data: toWrite as any });
      await this.accessLog.record({
        businessId: actor.businessId,
        actor,
        action: "settings.update",
        summary: settingsSummary(changedKeys, data),
        detail: { keys: changedKeys },
      });
    }
    return this.dto(actor.businessId);
  }

  /**
   * Operation mode rules, shared by PUT and proposal confirmation: only the owner changes it, commerce
   * needs a plan with `pharmacyCommerce` (otherwise 403 PLAN_FEATURE + upgradeTo), and the moment the
   * owner decided is recorded (operationModeChosenAt). Returns the extra columns to write.
   */
  private async operationModeRules(
    actor: MemberContext,
    row: Record<string, unknown>,
    data: Record<string, unknown>,
    changedKeys: string[],
    mentioned: boolean,
  ): Promise<Record<string, unknown>> {
    if (!mentioned || !("operationMode" in data)) return {};
    const changed = changedKeys.includes("operationMode");
    if (changed && actor.roleKey !== "owner") throw accessDenied("OWNER_PROTECTED", "Só o proprietário muda o modo de operação.");
    if (data.operationMode === "commerce" && changed) {
      const info = await loadOperationMode(this.prisma.client, actor.businessId);
      if (!info.commerceAllowedByPlan) {
        const blocked = commerceBlocked(info);
        throw new ForbiddenException({
          statusCode: 403,
          error: "Forbidden",
          code: blocked.code,
          message: "Disponível a partir do plano Profissional.",
          ...(info.upgradeToPlanCode ? { upgradeTo: info.upgradeToPlanCode } : {}),
        });
      }
    }
    if (changed || (!row.operationModeChosenAt && actor.roleKey === "owner")) return { operationModeChosenAt: new Date() };
    return {};
  }

  // ------------------------------------------------------------- proposals

  /**
   * Called when the onboarding interview stores a field of the farmacia template. Best-effort and
   * silent on failure: never blocks the interview. Does nothing for unmapped fields.
   */
  async proposeFromField(businessId: string, fieldKey: string, rawAnswer: string): Promise<void> {
    if (!(fieldKey in farmaciaSettingsFieldMap)) return;
    const row = await this.getRow(businessId);
    const proposals = { ...((row.proposals ?? {}) as Record<string, ProposalRecord>) };
    const record: ProposalRecord = {
      fieldKey,
      label: PROPOSAL_LABELS[fieldKey] ?? fieldKey,
      rawAnswer: rawAnswer.slice(0, 1000),
      proposed: parseProposal(fieldKey, rawAnswer),
      status: "pending",
      proposedAt: new Date().toISOString(),
      confirmedAt: null,
    };
    proposals[fieldKey] = record;
    await this.prisma.client.pharmacySettings.update({ where: { businessId }, data: { proposals: proposals as object } });
  }

  async confirmProposal(actor: MemberContext, fieldKey: string, values?: Record<string, unknown>) {
    const row = await this.getRow(actor.businessId);
    const proposals = { ...((row.proposals ?? {}) as Record<string, ProposalRecord>) };
    const p = proposals[fieldKey];
    if (!p) throw new NotFoundException("Proposta não encontrada.");
    const allowedKeys = farmaciaSettingsFieldMap[fieldKey] ?? [];
    const merged: Record<string, unknown> = { ...p.proposed };
    if (values && typeof values === "object") {
      for (const [k, v] of Object.entries(values)) {
        if (!allowedKeys.includes(k)) throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "INVALID_SETTING", message: `Campo não permitido para esta proposta: ${k}` });
        merged[k] = v;
      }
    }
    const { pharmacistRequiredProductNames, ...columns } = merged;
    if (Object.keys(columns).length === 0 && pharmacistRequiredProductNames === undefined) {
      throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "PROPOSAL_EMPTY", message: "Não foi possível interpretar a resposta. Informe os valores." });
    }
    const { data, changedKeys } = buildSettingsPatch(row as unknown as Record<string, unknown>, columns);
    if (changedKeys.some((k) => (IDENTITY_KEYS as readonly string[]).includes(k)) && actor.roleKey !== "owner") {
      throw accessDenied("OWNER_PROTECTED", "Identidade legal só para proprietário.");
    }
    let flagged = 0;
    if (Array.isArray(pharmacistRequiredProductNames)) {
      const matched = await this.matchProductsByName(actor.businessId, pharmacistRequiredProductNames as string[]);
      if (matched.length) {
        const res = await this.prisma.client.product.updateMany({ where: { businessId: actor.businessId, id: { in: matched.map((m) => m.id) } }, data: { pharmacistRequired: true } });
        flagged = res.count;
      }
    }
    const modeExtra = await this.operationModeRules(actor, row as unknown as Record<string, unknown>, data, changedKeys, "operationMode" in columns);
    proposals[fieldKey] = { ...p, proposed: merged, status: "confirmed", confirmedAt: new Date().toISOString() };
    await this.prisma.client.pharmacySettings.update({
      where: { businessId: actor.businessId },
      data: { ...(Object.fromEntries(changedKeys.map((k) => [k, data[k]])) as any), ...modeExtra, proposals: proposals as object },
    });
    await this.accessLog.record({
      businessId: actor.businessId,
      actor,
      action: "settings.update",
      summary: `Confirmou a proposta "${p.label}"${flagged ? ` (${flagged} produtos marcados como exigem farmacêutico)` : ""}`,
      detail: { keys: [...changedKeys, ...(flagged ? ["pharmacistRequired"] : [])] },
    });
    return this.dto(actor.businessId);
  }

  async dismissProposal(actor: MemberContext, fieldKey: string) {
    const row = await this.getRow(actor.businessId);
    const proposals = { ...((row.proposals ?? {}) as Record<string, ProposalRecord>) };
    if (!proposals[fieldKey]) throw new NotFoundException("Proposta não encontrada.");
    proposals[fieldKey] = { ...proposals[fieldKey], status: "dismissed" };
    await this.prisma.client.pharmacySettings.update({ where: { businessId: actor.businessId }, data: { proposals: proposals as object } });
    return this.dto(actor.businessId);
  }
}
