import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as bcrypt from "bcrypt";
import { parseOpeningHours, parseProposal, parseDeliveryAreas, parseBoolean } from "../src/modules/pharmacy-settings/proposals";
import { buildSettingsPatch, isValidCnpj, settingsSummary } from "../src/modules/pharmacy-settings/settings-validation";
import { PharmacySettingsService } from "../src/modules/pharmacy-settings/pharmacy-settings.service";
import { TeamService } from "../src/modules/team/team.service";
import { canViewAccessLog, hashToken, newToken, permissionSectionsFor, roleChangeSummary } from "../src/modules/team/team-helpers";
import { buildBriefRows, buildSuggestion, handoffDetailDto, whoLabel, type HandoffRow } from "../src/modules/handoffs/handoff-dto";
import { buildInsights, peakHourOf } from "../src/modules/pharmacy-dashboard/insights";
import { bucketIndex, bucketLabels, deltaNote, shortName, startOfLocalDay, windowFor } from "../src/modules/pharmacy-dashboard/time-buckets";
import { handoffTag } from "../src/modules/pharmacy-common/labels";
import { buildStarterPermissions, STARTER_ROLE_DEFS, type StarterRoleKey } from "@realwise/shared";
import type { MemberContext } from "../src/modules/access/member-context";

// ---------------------------------------------------------------- proposals from onboarding answers

test("CNPJ validation uses the check digits", () => {
  assert.equal(isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCnpj("11222333000181"), true);
  assert.equal(isValidCnpj("11222333000182"), false);
  assert.equal(isValidCnpj("00000000000000"), false);
  assert.equal(isValidCnpj("123"), false);
});

test("proposals: money, booleans, identity, pharmacist, hours, areas, payments, limits", () => {
  assert.deepEqual(parseProposal("taxa_entrega", "R$ 6,00"), { deliveryFeeCents: 600 });
  assert.deepEqual(parseProposal("taxa_entrega", "A taxa é 6,50 reais"), { deliveryFeeCents: 650 });
  assert.deepEqual(parseProposal("taxa_entrega", "Grátis"), { deliveryFeeCents: 0 });
  assert.deepEqual(parseProposal("taxa_entrega", "depende do bairro"), {}, "unparsable stays empty: the owner types it");
  assert.deepEqual(parseProposal("pedido_minimo", "R$ 15"), { minOrderCents: 1500 });
  assert.deepEqual(parseProposal("pedido_minimo", "Não tem mínimo"), { minOrderCents: 0 });
  assert.deepEqual(parseProposal("retirada_loja", "Sim, temos"), { pickupEnabled: true });
  assert.deepEqual(parseProposal("retirada_loja", "Não fazemos retirada"), { pickupEnabled: false });
  assert.deepEqual(parseProposal("retirada_loja", "talvez"), {});
  assert.deepEqual(parseProposal("razao_social_cnpj", "Farmácia Exemplo Ltda, CNPJ 11.222.333/0001-81"), { cnpj: "11222333000181", legalName: "Farmácia Exemplo Ltda" });
  assert.deepEqual(parseProposal("razao_social_cnpj", "Farmácia X 11.222.333/0001-99"), { legalName: "Farmácia X" }, "an invalid CNPJ is never proposed");
  assert.deepEqual(parseProposal("farmaceutico_responsavel", "Maria Souza, CRF-PR 1234"), { pharmacistCrf: "CRF-PR 1234", pharmacistName: "Maria Souza" });
  assert.deepEqual(parseProposal("afe_licenca", "AFE nº 1.23456.7"), { afeNumber: "1.23456.7" });
  assert.deepEqual(parseProposal("limite_quantidade_item", "No máximo 5 por item"), { maxQtyPerItemDefault: 5 });
  assert.deepEqual(parseProposal("limite_quantidade_item", "sem limite"), { maxQtyPerItemDefault: null });
  assert.deepEqual(parseProposal("formas_pagamento_entrega", "Pix, cartão de crédito e dinheiro"), { paymentMethods: ["pix", "cartao", "dinheiro"] });
  assert.deepEqual(parseProposal("produtos_exigem_farmaceutico", "Dipirona, Omeprazol e Ibuprofeno"), { pharmacistRequiredProductNames: ["Dipirona", "Omeprazol", "Ibuprofeno"] });
  assert.deepEqual(parseProposal("produtos_exigem_farmaceutico", "nenhum"), { pharmacistRequiredProductNames: [] });
  assert.deepEqual(parseProposal("politica_troca_devolucao", "Trocamos em até 7 dias."), { exchangePolicy: "Trocamos em até 7 dias." });
  assert.deepEqual(parseProposal("campo_inexistente", "x"), {});
  assert.deepEqual(parseProposal("taxa_entrega", "   "), {});
});

test("proposals: opening hours and delivery areas", () => {
  const hours = parseOpeningHours("Seg a Sex 8h às 20h, Sábado 8h às 18h, Domingo fechado")!;
  assert.deepEqual(hours, [
    { key: "weekdays", label: "Segunda a sexta", open: true, from: "08:00", to: "20:00" },
    { key: "saturday", label: "Sábado", open: true, from: "08:00", to: "18:00" },
    { key: "sunday", label: "Domingo e feriados", open: false },
  ]);
  assert.deepEqual(parseOpeningHours("Segunda a sexta das 08:00 às 22:00 e sábado das 9h às 13h")!.map((h) => [h.key, h.open, h.from, h.to]), [
    ["weekdays", true, "08:00", "22:00"],
    ["saturday", true, "09:00", "13:00"],
    ["sunday", false, undefined, undefined],
  ]);
  assert.ok(parseOpeningHours("Aberto 24 horas")!.every((h) => h.open && h.from === "00:00"));
  assert.deepEqual(parseOpeningHours("Todos os dias das 7h às 23h")!.map((h) => h.to), ["23:00", "23:00", "23:00"]);
  assert.equal(parseOpeningHours("quando dá"), null);
  assert.deepEqual(parseDeliveryAreas("Água Verde, Batel, CEP 80250"), [
    { type: "district", value: "Água Verde" },
    { type: "district", value: "Batel" },
    { type: "cep_prefix", value: "80250" },
  ]);
  assert.equal(parseBoolean("não"), false);
  assert.equal(parseBoolean("Sim"), true);
});

test("settings patch validation: ranges, formats, owner-only keys are detected as changes", () => {
  const current = { deliveryFeeCents: 600, cnpj: null, legalName: null, deliveryEnabled: true };
  const ok = buildSettingsPatch(current, { deliveryFeeCents: 700, minOrderCents: 1500, cnpj: "11.222.333/0001-81", deliveryEnabled: true });
  assert.deepEqual(ok.changedKeys.sort(), ["cnpj", "deliveryFeeCents", "minOrderCents"]);
  assert.equal(ok.data.cnpj, "11222333000181");
  assert.throws(() => buildSettingsPatch(current, { cnpj: "123" }), /CNPJ/);
  assert.throws(() => buildSettingsPatch(current, { deliveryFeeCents: -1 }));
  assert.throws(() => buildSettingsPatch(current, { deliveryFeeCents: 1.5 }));
  assert.throws(() => buildSettingsPatch(current, { stockMaxAgeHours: 0 }));
  assert.throws(() => buildSettingsPatch(current, { prescriptionRetentionDays: 9999 }));
  assert.throws(() => buildSettingsPatch(current, { orderReminderMinutes: 0 }));
  assert.throws(() => buildSettingsPatch(current, { paymentMethods: ["bitcoin"] }));
  assert.throws(() => buildSettingsPatch(current, { openingHours: [{ key: "a", label: "A", open: true, from: "25:00", to: "10:00" }] }));
  assert.throws(() => buildSettingsPatch(current, { deliveryAreas: [{ type: "cep_prefix", value: "12" }] }));
  assert.throws(() => buildSettingsPatch(current, { deliveryEnabled: "yes" }));
  assert.deepEqual(buildSettingsPatch(current, { deliveryAreas: [{ type: "cep_prefix", value: "80250-000" }] }).data.deliveryAreas, [{ type: "cep_prefix", value: "80250000" }]);
  assert.deepEqual(buildSettingsPatch(current, { paymentMethods: ["Pix", "pix"] }).data.paymentMethods, ["pix"]);
  assert.deepEqual(buildSettingsPatch(current, { unknownKey: 1, proposals: {}, nextOrderNumber: 1 }).changedKeys, [], "counters and proposals are not editable");
  assert.equal(settingsSummary(["deliveryFeeCents"], { deliveryFeeCents: 600 }), "Alterou taxa de entrega para R$ 6,00");
  assert.equal(settingsSummary(["openingHours", "pickupEnabled"], {}), "Alterou horários de funcionamento e retirada em loja");
  assert.equal(settingsSummary(["cnpj", "legalName"], { cnpj: "11222333000181" }), "Alterou identidade legal", "no PII in the log summary");
});

// ---------------------------------------------------------------- settings service (fake DB)

function member(key: StarterRoleKey, patch: Partial<MemberContext> = {}): MemberContext {
  const d = STARTER_ROLE_DEFS[key];
  return {
    memberId: `m-${key}`, businessId: "b1", niche: "farmacia", name: key === "owner" ? "Dona" : key, email: null, crf: key === "pharmacist" ? "CRF-PR 1" : null,
    roleId: `r-${key}`, roleKey: key, roleName: d.name, requiresCrf: d.requiresCrf, ownDeliveriesOnly: d.ownDeliveriesOnly, permissions: buildStarterPermissions("farmacia", key), ...patch,
  };
}

function fakeSettings() {
  const state: any = { row: { businessId: "b1", legalName: null, cnpj: null, deliveryFeeCents: 0, minOrderCents: 0, deliveryEnabled: true, pickupEnabled: true, proposals: {}, stockMaxAgeHours: 24 }, products: [{ id: "p1", name: "Dipirona 500 mg", pharmacistRequired: false }, { id: "p2", name: "Vitamina C", pharmacistRequired: false }], logs: [] as any[] };
  const prisma: any = {
    client: {
      pharmacySettings: {
        upsert: async () => state.row,
        findUniqueOrThrow: async () => ({ ...state.row }),
        findUnique: async () => ({ ...state.row }),
        update: async ({ data }: any) => Object.assign(state.row, data),
      },
      subscription: { findUnique: async () => ({ plan: { code: "profissional" } }) },
      catalogImport: { findFirst: async () => null },
      product: {
        findMany: async () => state.products.map((p: any) => ({ id: p.id, name: p.name })),
        updateMany: async ({ where, data }: any) => {
          const ids = where.id.in as string[];
          state.products.filter((p: any) => ids.includes(p.id)).forEach((p: any) => Object.assign(p, data));
          return { count: ids.length };
        },
      },
    },
  };
  const service = new PharmacySettingsService(prisma, { record: async (e: any) => state.logs.push(e) } as any);
  return { service, state };
}

test("settings: identity fields only by an Owner (OWNER_PROTECTED), others free for farmacia:edit", async () => {
  const { service, state } = fakeSettings();
  await assert.rejects(() => service.update(member("manager"), { cnpj: "11222333000181" }), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  await assert.rejects(() => service.update(member("manager"), { legalName: "X" }), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  assert.equal(state.row.cnpj, null);
  const dto = await service.update(member("manager"), { deliveryFeeCents: 600 });
  assert.equal(dto.settings.deliveryFeeCents, 600);
  assert.equal(state.logs[0].action, "settings.update");
  assert.equal(state.logs[0].summary, "Alterou taxa de entrega para R$ 6,00");
  await service.update(member("owner"), { cnpj: "11.222.333/0001-81", legalName: "Farmácia Exemplo" });
  assert.equal(state.row.cnpj, "11222333000181");
  assert.ok(!JSON.stringify(state.logs).includes("11222333000181"), "no CNPJ in the access log");
  const noChange = state.logs.length;
  await service.update(member("manager"), { deliveryFeeCents: 600 });
  assert.equal(state.logs.length, noChange, "a no-op save is not logged");
  assert.ok(dto.banner.includes("sempre ativas"));
});

test("proposals: created from interview answers, nothing applied until the owner confirms", async () => {
  const { service, state } = fakeSettings();
  await service.proposeFromField("b1", "taxa_entrega", "R$ 6,00");
  await service.proposeFromField("b1", "produtos_exigem_farmaceutico", "Dipirona, Omeprazol");
  await service.proposeFromField("b1", "nao_mapeado", "x");
  assert.equal(state.row.deliveryFeeCents, 0, "nothing applied silently");
  assert.deepEqual(Object.keys(state.row.proposals).sort(), ["produtos_exigem_farmaceutico", "taxa_entrega"]);
  assert.equal(state.row.proposals.taxa_entrega.status, "pending");
  assert.deepEqual(state.row.proposals.taxa_entrega.proposed, { deliveryFeeCents: 600 });
  let dto = await service.dto("b1");
  assert.deepEqual(dto.proposals.produtos_exigem_farmaceutico.matchedProducts, [{ id: "p1", name: "Dipirona 500 mg" }]);

  dto = await service.confirmProposal(member("manager"), "taxa_entrega", { deliveryFeeCents: 650 });
  assert.equal(state.row.deliveryFeeCents, 650, "owner-edited value wins over the parsed one");
  assert.equal(dto.proposals.taxa_entrega.status, "confirmed");
  await assert.rejects(() => service.confirmProposal(member("manager"), "taxa_entrega", { minOrderCents: 1 }), (e: any) => e.getResponse().code === "INVALID_SETTING", "only the proposal's own keys");

  await service.confirmProposal(member("manager"), "produtos_exigem_farmaceutico");
  assert.equal(state.products[0].pharmacistRequired, true);
  assert.equal(state.products[1].pharmacistRequired, false);

  await service.proposeFromField("b1", "retirada_loja", "talvez");
  await assert.rejects(() => service.confirmProposal(member("manager"), "retirada_loja"), (e: any) => e.getResponse().code === "PROPOSAL_EMPTY");
  const dismissed = await service.dismissProposal(member("manager"), "retirada_loja");
  assert.equal(dismissed.proposals.retirada_loja.status, "dismissed");
  await assert.rejects(() => service.dismissProposal(member("manager"), "nope"), (e: any) => e.getStatus() === 404);

  await service.proposeFromField("b1", "razao_social_cnpj", "Farmácia Y, 11.222.333/0001-81");
  await assert.rejects(() => service.confirmProposal(member("manager"), "razao_social_cnpj"), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  await service.confirmProposal(member("owner"), "razao_social_cnpj");
  assert.equal(state.row.legalName, "Farmácia Y");
});

// ---------------------------------------------------------------- team service (fake DB)

function fakeTeam() {
  const roles: any[] = ["owner", "pharmacist", "manager", "attendant", "courier"].map((key) => ({
    id: `r-${key}`, businessId: "b1", key, name: STARTER_ROLE_DEFS[key as StarterRoleKey].name, description: null, isStarter: true,
    requiresCrf: STARTER_ROLE_DEFS[key as StarterRoleKey].requiresCrf, ownDeliveriesOnly: STARTER_ROLE_DEFS[key as StarterRoleKey].ownDeliveriesOnly,
    permissions: buildStarterPermissions("farmacia", key as StarterRoleKey), createdAt: new Date(),
  }));
  const members: any[] = [
    { id: "m-owner", businessId: "b1", name: "Dona", email: "o@x.com", crf: null, status: "active", roleId: "r-owner", passwordHash: "h", phone: "+55", lastAccessAt: null, createdAt: new Date(1) },
    { id: "m-mgr", businessId: "b1", name: "Gabi", email: "g@x.com", crf: null, status: "active", roleId: "r-manager", passwordHash: "h", phone: null, lastAccessAt: null, createdAt: new Date(2) },
    { id: "m-att", businessId: "b1", name: "Ana", email: "a@x.com", crf: null, status: "active", roleId: "r-attendant", passwordHash: "h", phone: null, lastAccessAt: null, createdAt: new Date(3) },
  ];
  const invites: any[] = [];
  const logs: any[] = [];
  const withRole = (m: any) => ({ ...m, role: roles.find((r) => r.id === m.roleId) });
  const prisma: any = {
    client: {
      role: {
        findFirst: async ({ where }: any) => roles.find((r) => (!where.id || r.id === where.id) && (!where.key || r.key === where.key) && r.businessId === where.businessId && (!where.name || r.name.toLowerCase() === where.name.equals.toLowerCase())) ?? null,
        create: async ({ data }: any) => { const r = { id: `r-${roles.length}`, createdAt: new Date(), key: null, ...data }; roles.push(r); return r; },
        update: async ({ where, data }: any) => Object.assign(roles.find((r) => r.id === where.id), data),
        delete: async ({ where }: any) => roles.splice(roles.findIndex((r) => r.id === where.id), 1),
      },
      businessMember: {
        findFirst: async ({ where }: any) => {
          const m = members.find((x) => x.businessId === where.businessId && (!where.id || x.id === where.id) && (!where.email || x.email === where.email));
          return m ? withRole(m) : null;
        },
        count: async ({ where }: any) => members.filter((m) => (!where.roleId || m.roleId === where.roleId) && (!where.status || m.status === where.status) && (!where.role?.key || roles.find((r) => r.id === m.roleId)?.key === where.role.key)).length,
        create: async ({ data }: any) => { const m = { id: `m-${members.length}`, createdAt: new Date(), lastAccessAt: null, crf: null, passwordHash: null, phone: null, ...data }; members.push(m); return withRole(m); },
        update: async ({ where, data }: any) => withRole(Object.assign(members.find((m) => m.id === where.id), data)),
        delete: async ({ where }: any) => members.splice(members.findIndex((m) => m.id === where.id), 1),
      },
      memberInvite: { updateMany: async () => ({ count: 0 }), create: async ({ data }: any) => { invites.push(data); return data; } },
      business: { findUnique: async () => ({ name: "Farmácia" }) },
      $transaction: async (ops: any[]) => Promise.all(ops),
    },
  };
  const service = new TeamService(prisma, { record: async (e: any) => logs.push(e), list: async () => ({ items: [], nextCursor: null }) } as any, {} as any, {} as any);
  return { service, members, roles, invites, logs };
}

test("team: a Manager cannot grant Owner nor touch an Owner; invites default to Attendant", async () => {
  const { service, members, invites } = fakeTeam();
  const mgr = member("manager", { memberId: "m-mgr", roleId: "r-manager" });
  const owner = member("owner", { memberId: "m-owner", roleId: "r-owner" });
  await assert.rejects(() => service.invite(mgr, { email: "x@x.com", roleId: "r-owner" }), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  const res = await service.invite(mgr, { email: "New@X.com", name: "Novo" });
  assert.equal(res.member.role.key, "attendant");
  assert.equal(res.member.status, "invited");
  assert.equal(res.member.email, "new@x.com");
  assert.ok(typeof (res as any).inviteUrl === "string" || process.env.RESEND_API_KEY, "dev: the link is returned when email is not configured");
  assert.equal(invites[0].kind, "invite");
  assert.ok(invites[0].tokenHash && !JSON.stringify(invites[0]).includes((res as any).inviteUrl?.split("/").pop() ?? "∅"), "only the token hash is stored");
  await assert.rejects(() => service.invite(mgr, { email: "a@x.com" }), (e: any) => e.getResponse().code === "EMAIL_IN_USE");
  await assert.rejects(() => service.invite(mgr, { email: "not-an-email" }), (e: any) => e.getResponse().code === "INVALID_EMAIL");
  await assert.rejects(() => service.setDisabled(mgr, "m-owner", true), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  await assert.rejects(() => service.updateMember(mgr, "m-owner", { name: "Hack" }), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  // the owner can promote to owner
  const promoted = await service.updateMember(owner, "m-att", { roleId: "r-owner" });
  assert.equal(promoted.role.key, "owner");
  assert.equal(members.find((m) => m.id === "m-att")!.roleId, "r-owner");
});

test("team: last Owner can never be disabled, downgraded or removed; own role cannot change", async () => {
  const { service } = fakeTeam();
  const owner = member("owner", { memberId: "m-owner", roleId: "r-owner" });
  const mgr = member("manager", { memberId: "m-mgr", roleId: "r-manager" });
  await assert.rejects(() => service.setDisabled(owner, "m-owner", true), (e: any) => e.getResponse().code === "LAST_OWNER");
  await assert.rejects(() => service.updateMember(member("owner", { memberId: "m-other-owner" }), "m-owner", { roleId: "r-manager" }), (e: any) => e.getResponse().code === "LAST_OWNER");
  await assert.rejects(() => service.updateMember(mgr, "m-mgr", { roleId: "r-attendant" }), (e: any) => e.getResponse().code === "CANNOT_CHANGE_OWN_ROLE");
  // two owners: now the first can be downgraded
  await service.updateMember(owner, "m-att", { roleId: "r-owner" });
  const downgraded = await service.updateMember(member("owner", { memberId: "m-att", roleId: "r-owner" }), "m-owner", { roleId: "r-manager" });
  assert.equal(downgraded.role.key, "manager");
});

test("team: CRF rules, role-change log wording, disable/enable, removal only for invited", async () => {
  const { service, members, logs } = fakeTeam();
  const owner = member("owner", { memberId: "m-owner", roleId: "r-owner" });
  await service.updateMember(owner, "m-mgr", { roleId: "r-attendant" });
  assert.equal(logs.at(-1).action, "team.role_change");
  assert.equal(logs.at(-1).summary, "Alterou Gabi de Gerente para Atendente");
  // active member to a CRF role needs a CRF
  await assert.rejects(() => service.updateMember(owner, "m-att", { roleId: "r-pharmacist" }), (e: any) => e.getResponse().code === "CRF_REQUIRED_FOR_ROLE");
  const withCrf = await service.updateMember(owner, "m-att", { roleId: "r-pharmacist", crf: "CRF-PR 5555" });
  assert.equal(withCrf.crf, "CRF-PR 5555");
  assert.equal(withCrf.role.key, "pharmacist");
  const off = await service.setDisabled(owner, "m-att", true);
  assert.equal(off.status, "disabled");
  assert.equal(logs.at(-1).action, "team.disable");
  const on = await service.setDisabled(owner, "m-att", false);
  assert.equal(on.status, "active");
  assert.equal(logs.at(-1).action, "team.enable");
  await assert.rejects(() => service.removeInvited(owner, "m-att"), (e: any) => e.getResponse().code === "MEMBER_HAS_HISTORY");
  const invited = await service.invite(owner, { email: "zz@x.com" });
  assert.deepEqual(await service.removeInvited(owner, invited.member.id), { ok: true });
  assert.equal(members.some((m) => m.email === "zz@x.com"), false);
  await assert.rejects(() => service.updateMember(owner, "ghost", { name: "x" }), (e: any) => e.getStatus() === 404);
});

test("team: custom role validation, starter roles immutable, delete blocked while in use", async () => {
  const { service } = fakeTeam();
  const owner = member("owner", { memberId: "m-owner", roleId: "r-owner" });
  await assert.rejects(() => service.createRole(owner, { name: "Rx", requiresCrf: false, permissions: { receitas: "edit" } }), (e: any) => e.getResponse().code === "INVALID_ROLE");
  await assert.rejects(() => service.createRole(owner, { name: "Rx", requiresCrf: false, permissions: { conversas: "edit" } }), (e: any) => e.getResponse().code === "INVALID_ROLE", "conversas is read-only for pharmacy");
  await assert.rejects(() => service.createRole(owner, { name: "Rx", requiresCrf: false, permissions: { leads: "view" } }), (e: any) => e.getResponse().code === "INVALID_ROLE", "sales sections do not exist for pharmacy");
  await assert.rejects(() => service.createRole(owner, { name: "x", permissions: {} }), (e: any) => e.getResponse().code === "INVALID_NAME");
  const role = await service.createRole(owner, { name: "Balconista", requiresCrf: false, permissions: { pedidos: "edit", catalogo: "view" } });
  assert.equal(role.permissions.pedidos, "edit");
  assert.equal(role.permissions.equipe, "none");
  assert.equal(role.isStarter, false);
  await assert.rejects(() => service.createRole(owner, { name: "balconista", permissions: {} }), (e: any) => e.getResponse().code === "ROLE_NAME_IN_USE");
  const upd = await service.updateRole(owner, role.id, { permissions: { pedidos: "view" } });
  assert.equal(upd.permissions.pedidos, "view");
  await assert.rejects(() => service.updateRole(owner, "r-manager", { name: "Chefe" }), (e: any) => e.getResponse().code === "STARTER_ROLE");
  await assert.rejects(() => service.updateRole(owner, "r-owner", { name: "Chefe" }), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  await assert.rejects(() => service.deleteRole(owner, "r-attendant"), (e: any) => e.getResponse().code === "STARTER_ROLE");
  await assert.rejects(() => service.deleteRole(owner, "r-owner"), (e: any) => e.getResponse().code === "OWNER_PROTECTED");
  assert.deepEqual(await service.deleteRole(owner, role.id), { ok: true });
});

test("team: access log is for owner / manager only", async () => {
  const { service } = fakeTeam();
  assert.equal(canViewAccessLog("owner"), true);
  assert.equal(canViewAccessLog("manager"), true);
  assert.equal(canViewAccessLog("pharmacist"), false);
  assert.equal(canViewAccessLog(null), false);
  await assert.rejects(() => service.listAccessLog(member("attendant", { permissions: { ...buildStarterPermissions("farmacia", "attendant"), equipe: "view" } }), {}), (e: any) => e.getStatus() === 403);
  assert.deepEqual(await service.listAccessLog(member("manager"), {}), { items: [], nextCursor: null });
});

test("invite tokens: random, only the SHA-256 is stored", () => {
  const a = newToken();
  const b = newToken();
  assert.notEqual(a.raw, b.raw);
  assert.equal(a.raw.length, 64);
  assert.equal(a.hash, hashToken(a.raw));
  assert.notEqual(a.hash, a.raw);
});

test("permission grid sections: pharmacy rows in prototype order with notes and locks", () => {
  const rows = permissionSectionsFor("farmacia");
  assert.deepEqual(rows.map((r) => r.key), ["inicio", "pedidos", "receitas", "atendimento", "catalogo", "importar", "classes", "clientes", "conversas", "analises", "farmacia", "equipe", "plano"]);
  assert.equal(rows.find((r) => r.key === "conversas")!.readOnly, true);
  assert.equal(rows.find((r) => r.key === "receitas")!.crfOnly, true);
  assert.equal(rows.find((r) => r.key === "classes")!.crfOnly, true);
  assert.equal(rows.find((r) => r.key === "pedidos")!.crfOnly, false);
  assert.match(rows.find((r) => r.key === "clientes")!.note ?? "", /saúde/);
  assert.equal(roleChangeSummary("Bruno Dias", "Entregador", "Atendente"), "Alterou Bruno Dias de Entregador para Atendente");
});

test("password hashes use bcrypt (sanity for accept-invite)", async () => {
  assert.equal(await bcrypt.compare("senha-forte-1", await bcrypt.hash("senha-forte-1", 4)), true);
});

// ---------------------------------------------------------------- handoffs

const BRIEF = {
  symptoms: "Dor de cabeça forte", duration: "Há 3 dias", severity: "Forte, piora à noite",
  forWhom: { relation: "Para mim", age: "34", pregnant: false },
  allergies: ["dipirona"], otherMedicines: ["losartana"], alreadyTried: ["ibuprofeno sem melhora"], redFlags: [],
  suggestedProducts: [
    { productId: "p1", name: "Paracetamol 750 mg", reason: "ok", inStock: true, priceCents: 1120 },
    { productId: "p2", name: "Antigripal", reason: "x", inStock: true, priceCents: 900 },
  ],
};

test("brief rows follow the prototype order and skip empty values", () => {
  assert.deepEqual(buildBriefRows(BRIEF), [
    { label: "Sintoma", value: "Dor de cabeça forte" },
    { label: "Duração", value: "Há 3 dias" },
    { label: "Intensidade", value: "Forte, piora à noite" },
    { label: "Para quem", value: "Para mim, 34" },
    { label: "Gestante", value: "Não" },
    { label: "Alergias", value: "dipirona" },
    { label: "Outros remédios", value: "losartana" },
    { label: "Já tentou", value: "ibuprofeno sem melhora" },
  ]);
  const controlled = buildBriefRows({ medication: "Clonazepam 2 mg", availability: "Disponível na loja", priceInformedCents: 2490, onlineSaleAllowed: false, customerRequest: "Quer comprar para entrega" });
  assert.deepEqual(controlled.map((r) => [r.label, r.value]), [
    ["Medicamento", "Clonazepam 2 mg"],
    ["Disponibilidade", "Disponível na loja"],
    ["Preço informado", "R$ 24,90"],
    ["Venda online", "Não permitida"],
    ["Pedido do cliente", "Quer comprar para entrega"],
  ]);
  assert.deepEqual(buildBriefRows({}), []);
  assert.deepEqual(buildBriefRows(null), []);
});

test("suggestion only lists products that are in stock right now", () => {
  const live = new Map([["p1", { name: "Paracetamol 750 mg", priceCents: 1120, stockQty: 4 }], ["p2", { name: "Antigripal", priceCents: 900, stockQty: 0 }]]);
  const s = buildSuggestion(BRIEF, live)!;
  assert.deepEqual(s.products.map((p) => p.productId), ["p1"]);
  assert.equal(s.label, "Sugestão para o farmacêutico, não enviada ao cliente");
  assert.equal(s.text, "Paracetamol 750 mg · em estoque · R$ 11,20. Alergia informada: dipirona.");
  assert.equal(buildSuggestion(BRIEF, new Map()), null, "brief said in stock but the catalog no longer has it");
  assert.equal(buildSuggestion({}, live), null);
});

test("handoff dto: tags, who label, answer block, waiting minutes", () => {
  const h: HandoffRow = {
    id: "h1", conversationId: "c1", reason: "symptom", urgent: true, summary: "Dor de cabeça · há 3 dias", brief: BRIEF, status: "open",
    answerText: null, answeredAt: null, answeredByName: null, answeredByRole: null, createdAt: new Date("2026-10-13T12:00:00Z"), lead: { name: "Maria Souza" },
  };
  const dto = handoffDetailDto(h, null, Date.parse("2026-10-13T12:04:00Z"));
  assert.equal(dto.who, "Maria, 34");
  assert.equal(dto.tag, "Urgente");
  assert.equal(dto.tagBadge, "red");
  assert.equal(dto.waitingMinutes, 4);
  assert.equal(dto.conversationLink, "/conversas?open=c1");
  assert.equal(dto.answer, null);
  assert.equal(whoLabel({ lead: null, brief: {} }), "Cliente");
  assert.deepEqual(handoffTag("controlled", false), { tag: "Controlado", tagBadge: "gray" });
  assert.deepEqual(handoffTag("out_of_stock", false), { tag: "Sem estoque", tagBadge: "amber" });
  assert.equal(handoffTag("rx", false).tag, "Receita");
  assert.equal(handoffTag("controlled", true).tag, "Urgente");
  const answered = handoffDetailDto({ ...h, status: "answered", answerText: "Olá", answeredAt: new Date("2026-10-13T12:10:00Z"), answeredByName: "Paulo", answeredByRole: "Farmacêutico RT" }, null);
  assert.deepEqual(answered.answer, { text: "Olá", at: "2026-10-13T12:10:00.000Z", byName: "Paulo", byRole: "Farmacêutico RT" });
  assert.equal(answered.waitingMinutes, 0);
});

// ---------------------------------------------------------------- dashboard helpers

test("time windows and chart buckets honour the business time zone", () => {
  const tz = "America/Sao_Paulo";
  const now = new Date("2026-10-14T02:30:00Z"); // 23:30 on Oct 13 in São Paulo
  assert.equal(startOfLocalDay(now, tz).toISOString(), "2026-10-13T03:00:00.000Z");
  assert.equal(windowFor("today", now, tz).from.toISOString(), "2026-10-13T03:00:00.000Z");
  assert.equal(windowFor("7d", now, tz).from.toISOString(), "2026-10-07T03:00:00.000Z");
  assert.deepEqual(bucketLabels("today", now, tz), ["8h", "10h", "12h", "14h", "16h", "18h", "20h"]);
  assert.deepEqual(bucketLabels("30d", now, tz), ["S1", "S2", "S3", "S4", "S5"]);
  assert.deepEqual(bucketLabels("7d", now, tz), ["Qua", "Qui", "Sex", "Sáb", "Dom", "Seg", "Ter"]);
  assert.equal(bucketIndex("7d", new Date("2026-10-13T15:00:00Z"), now, tz), 6, "today is the last bucket");
  assert.equal(bucketIndex("7d", new Date("2026-10-07T04:00:00Z"), now, tz), 0);
  assert.equal(bucketIndex("7d", new Date("2026-10-06T12:00:00Z"), now, tz), -1);
  assert.equal(bucketIndex("today", new Date("2026-10-13T15:00:00Z"), now, tz), 2, "12h local");
  assert.equal(bucketIndex("today", new Date("2026-10-13T09:30:00Z"), now, tz), 0, "06:30 local clamps to the first bucket");
  assert.equal(bucketIndex("30d", now, now, tz), 4);
  assert.equal(bucketIndex("30d", new Date("2026-09-15T12:00:00Z"), now, tz), 0);
  assert.equal(deltaNote(5, 2), "+3 em relação a ontem");
  assert.equal(deltaNote(2, 5), "-3 em relação a ontem");
  assert.equal(deltaNote(2, 2), "igual a ontem");
  assert.equal(shortName("João Silva"), "João S.");
  assert.equal(shortName("Maria"), "Maria");
  assert.equal(shortName(null), "Cliente");
});

test("insights are deterministic rules over aggregated data and respect permissions", () => {
  const all = { catalogo: true, classes: true, importar: true, analises: true, pedidos: true };
  const insights = buildInsights({
    days: 7,
    topUnmet: { name: "Dipirona 500 mg", requests: 14 },
    peakHour: { hour: 18, share: 0.3 },
    unclassifiedCount: 148,
    slowConfirm: { avgMinutes: 22, reminderMinutes: 10, orders: 8 },
    staleSheet: { ageHours: 30, maxAgeHours: 24 },
    can: all,
  });
  assert.deepEqual(insights.map((i) => i.id), ["stale-sheet", "stock-out-top", "unclassified", "slow-confirm", "peak-hour"]);
  const top = insights.find((i) => i.id === "stock-out-top")!;
  assert.equal(top.title, "Dipirona 500 mg sem estoque");
  assert.equal(top.description, "14 clientes pediram nos últimos 7 dias e não puderam comprar.");
  assert.deepEqual(top.cta, { label: "Abrir catálogo", href: "/catalogo?stock=out" });
  assert.equal(buildInsights({ days: 7, topUnmet: { name: "X", requests: 1 }, can: all })[0].description, "1 cliente pediu nos últimos 7 dias e não pôde comprar.");
  assert.deepEqual(buildInsights({ days: 7, topUnmet: { name: "X", requests: 3 }, unclassifiedCount: 5, can: { ...all, analises: false, classes: false } }), []);
  assert.deepEqual(buildInsights({ days: 7, slowConfirm: { avgMinutes: 5, reminderMinutes: 10, orders: 10 }, can: all }), [], "fast confirmation is not an insight");
  assert.deepEqual(buildInsights({ days: 7, slowConfirm: { avgMinutes: 50, reminderMinutes: 10, orders: 1 }, can: all }), [], "too few orders to say anything");
  assert.deepEqual(peakHourOf([18, 18, 18, 9, 10, 11]), { hour: 18, share: 0.5 });
  assert.equal(peakHourOf([1, 2]), null);
});
