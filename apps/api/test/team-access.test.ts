process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123456";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as bcrypt from "bcrypt";
import { Reflector } from "@nestjs/core";
import { verifyBusinessSession } from "@realwise/auth";
import {
  CRF_SECTIONS,
  NICHE_SECTIONS,
  PERMISSION_SECTIONS,
  buildStarterPermissions,
  hasPermission,
  normalizePermissions,
  resolveBranding,
  starterRoleKeysForNiche,
  validateRoleDefinition,
  visibleSections,
} from "@realwise/shared";
import { PermissionsGuard } from "../src/modules/access/permissions.guard";
import { REQUIRE_CRF_KEY, REQUIRE_PERMISSION_KEY } from "../src/modules/access/permission.decorator";
import {
  assertCanGrantRole,
  assertCanModifyMember,
  assertCrfForRole,
  assertNotLastOwner,
  assertRoleEditable,
  hasCrfOnFile,
} from "../src/modules/access/team-rules";
import { AccessLogService, categoryForAction } from "../src/modules/access/access-log.service";
import { MemberContextService } from "../src/modules/access/member-context.service";
import { MemberAuthService } from "../src/modules/access/member-auth.service";
import type { MemberContext } from "../src/modules/access/member-context";

// ---------- permission model ----------

test("starter grids match the prototype matrix for pharmacy", () => {
  const owner = buildStarterPermissions("farmacia", "owner");
  const pharm = buildStarterPermissions("farmacia", "pharmacist");
  const manager = buildStarterPermissions("farmacia", "manager");
  const attendant = buildStarterPermissions("farmacia", "attendant");
  const courier = buildStarterPermissions("farmacia", "courier");
  assert.equal(owner.equipe, "edit");
  assert.equal(owner.classes, "view"); // owner cannot confirm classes
  assert.equal(pharm.classes, "edit");
  assert.equal(pharm.receitas, "edit");
  assert.equal(pharm.atendimento, "edit");
  assert.equal(manager.classes, "none");
  assert.equal(manager.farmacia, "edit");
  assert.equal(attendant.catalogo, "view");
  assert.equal(attendant.equipe, "none");
  assert.equal(courier.pedidos, "edit");
  assert.equal(courier.catalogo, "none");
  for (const key of ["owner", "pharmacist", "manager", "attendant", "courier"] as const) {
    const p = buildStarterPermissions("farmacia", key);
    for (const s of PERMISSION_SECTIONS) {
      if (!NICHE_SECTIONS.farmacia.includes(s)) assert.equal(p[s], "none", `${key}.${s} must be none outside the niche`);
    }
  }
});

test("only roles flagged requiresCrf may edit CRF sections; no starter role other than pharmacist edits them", () => {
  for (const key of starterRoleKeysForNiche("farmacia")) {
    const p = buildStarterPermissions("farmacia", key);
    for (const s of CRF_SECTIONS) {
      if (key !== "pharmacist") assert.notEqual(p[s], "edit", `${key}.${s}`);
    }
  }
});

test("sales niches get owner / manager / attendant only", () => {
  assert.deepEqual(starterRoleKeysForNiche("imobiliaria"), ["owner", "manager", "attendant"]);
  assert.deepEqual(starterRoleKeysForNiche("concessionaria"), ["owner", "manager", "attendant"]);
  assert.equal(buildStarterPermissions("imobiliaria", "owner").imoveis, "edit");
  assert.equal(buildStarterPermissions("imobiliaria", "attendant").configuracoes, "none");
});

test("hasPermission and visibleSections", () => {
  const perms = normalizePermissions({ pedidos: "edit", catalogo: "view", clientes: "none", bogus: "edit" });
  assert.equal(hasPermission(perms, "pedidos", "edit"), true);
  assert.equal(hasPermission(perms, "catalogo", "edit"), false);
  assert.equal(hasPermission(perms, "catalogo", "view"), true);
  assert.equal(hasPermission(perms, "clientes", "view"), false);
  assert.equal(hasPermission(undefined, "pedidos", "view"), false);
  assert.deepEqual(visibleSections(perms, "farmacia"), ["pedidos", "catalogo"]);
});

test("validateRoleDefinition blocks CRF edits without requiresCrf, unknown sections and read-only edits", () => {
  const bad = validateRoleDefinition({ permissions: { receitas: "edit", conversas: "edit", nope: "edit", pedidos: "view" }, requiresCrf: false, niche: "farmacia" });
  assert.ok(bad.some((e) => e.includes("Receitas")));
  assert.ok(bad.some((e) => e.includes("Conversas")));
  assert.ok(bad.some((e) => e.includes("nope")));
  const ok = validateRoleDefinition({ permissions: { receitas: "edit", pedidos: "edit" }, requiresCrf: true, niche: "farmacia" });
  assert.deepEqual(ok, []);
  const wrongNiche = validateRoleDefinition({ permissions: { pedidos: "view" }, requiresCrf: false, niche: "imobiliaria" });
  assert.equal(wrongNiche.length, 1);
});

test("resolveBranding falls back to the niche default and ignores invalid colours", () => {
  assert.deepEqual(resolveBranding("farmacia", {}), { primaryColor: "#0F766E", secondaryColor: "#0B4F4A", tertiaryColor: "#F59E0B" });
  const b = resolveBranding("farmacia", { primaryColor: "#112233", secondaryColor: "red", tertiaryColor: null });
  assert.equal(b.primaryColor, "#112233");
  assert.equal(b.secondaryColor, "#0B4F4A");
});

// ---------- team rules ----------

const owner = { memberId: "m1", roleKey: "owner" };
const manager = { memberId: "m2", roleKey: "manager" };

function denied(fn: () => void, code: string) {
  assert.throws(fn, (e: any) => e.getStatus?.() === 403 && e.getResponse().code === code);
}

test("manager cannot grant Owner nor modify Owners; owner can", () => {
  denied(() => assertCanGrantRole(manager, "owner"), "OWNER_PROTECTED");
  assertCanGrantRole(manager, "attendant");
  assertCanGrantRole(owner, "owner");
  denied(() => assertCanModifyMember(manager, { id: "x", roleKey: "owner", status: "active" }), "OWNER_PROTECTED");
  assertCanModifyMember(manager, { id: "x", roleKey: "attendant", status: "active" });
  assertCanModifyMember(owner, { id: "x", roleKey: "owner", status: "active" });
});

test("last owner cannot be removed, disabled or downgraded", () => {
  const lastOwner = { id: "m1", roleKey: "owner", status: "active" as const };
  denied(() => assertNotLastOwner(lastOwner, 1, { type: "remove" }), "LAST_OWNER");
  denied(() => assertNotLastOwner(lastOwner, 1, { type: "disable" }), "LAST_OWNER");
  denied(() => assertNotLastOwner(lastOwner, 1, { type: "role", newRoleKey: "manager" }), "LAST_OWNER");
  assertNotLastOwner(lastOwner, 1, { type: "role", newRoleKey: "owner" });
  assertNotLastOwner(lastOwner, 2, { type: "remove" });
  assertNotLastOwner({ id: "m3", roleKey: "attendant", status: "active" }, 1, { type: "remove" });
});

test("CRF rules", () => {
  assert.equal(hasCrfOnFile("CRF-PR 1234"), true);
  assert.equal(hasCrfOnFile("  "), false);
  assert.equal(hasCrfOnFile(null), false);
  assert.throws(() => assertCrfForRole({ requiresCrf: true, name: "Farmacêutico RT" }, null), (e: any) => e.getResponse().code === "CRF_REQUIRED_FOR_ROLE");
  assertCrfForRole({ requiresCrf: true, name: "Farmacêutico RT" }, "CRF-PR 1234");
  assertCrfForRole({ requiresCrf: false, name: "Atendente" }, null);
});

test("starter roles cannot be edited or deleted; owner role never", () => {
  denied(() => assertRoleEditable({ isStarter: true, key: "owner" }, "update"), "OWNER_PROTECTED");
  assert.throws(() => assertRoleEditable({ isStarter: true, key: "manager" }, "delete"));
  assert.throws(() => assertRoleEditable({ isStarter: true, key: "manager" }, "update"));
  assertRoleEditable({ isStarter: false, key: null }, "delete");
});

// ---------- guard ----------

function ctxWith(member: Partial<MemberContext> | undefined, meta: { perm?: any; crf?: boolean }) {
  const handler = () => {};
  const klass = class {};
  if (meta.perm) Reflect.defineMetadata(REQUIRE_PERMISSION_KEY, meta.perm, handler);
  if (meta.crf) Reflect.defineMetadata(REQUIRE_CRF_KEY, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => klass,
    switchToHttp: () => ({ getRequest: () => ({ member }) }),
  } as any;
}
const guard = new PermissionsGuard(new Reflector());
const pharmacist: MemberContext = {
  memberId: "p", businessId: "b", niche: "farmacia", name: "Paulo", email: null, crf: "CRF-PR 1234", roleId: "r", roleKey: "pharmacist",
  roleName: "Farmacêutico RT", requiresCrf: true, ownDeliveriesOnly: false, permissions: buildStarterPermissions("farmacia", "pharmacist"),
};

test("PermissionsGuard: allows, denies with documented 403 shape, supports alternative sections", () => {
  assert.equal(guard.canActivate(ctxWith(pharmacist, { perm: { sections: ["receitas"], level: "edit" } })), true);
  const att: MemberContext = { ...pharmacist, roleKey: "attendant", requiresCrf: false, permissions: buildStarterPermissions("farmacia", "attendant") };
  assert.throws(
    () => guard.canActivate(ctxWith(att, { perm: { sections: ["receitas"], level: "edit" } })),
    (e: any) => {
      const r = e.getResponse();
      return e.getStatus() === 403 && r.code === "PERMISSION_DENIED" && r.section === "receitas" && r.required === "edit" && r.error === "Forbidden" && typeof r.message === "string";
    },
  );
  assert.equal(guard.canActivate(ctxWith(att, { perm: { sections: ["configuracoes", "pedidos"], level: "edit" } })), true);
  assert.throws(() => guard.canActivate(ctxWith(undefined, { perm: { sections: ["inicio"], level: "view" } })), (e: any) => e.getStatus() === 403);
});

test("PermissionsGuard: @RequireCrf needs a CRF role AND a CRF number", () => {
  const meta = { perm: { sections: ["receitas"], level: "edit" }, crf: true };
  assert.equal(guard.canActivate(ctxWith(pharmacist, meta)), true);
  assert.throws(() => guard.canActivate(ctxWith({ ...pharmacist, crf: null }, meta)), (e: any) => e.getResponse().code === "CRF_REQUIRED");
  // a custom role with edit but no requiresCrf flag cannot pass either
  assert.throws(() => guard.canActivate(ctxWith({ ...pharmacist, requiresCrf: false }, meta)), (e: any) => e.getResponse().code === "CRF_REQUIRED");
});

// ---------- access log ----------

test("AccessLogService.record never throws and maps categories", async () => {
  const created: any[] = [];
  const prisma: any = { client: { accessLogEntry: { create: async ({ data }: any) => created.push(data) } } };
  const svc = new AccessLogService(prisma);
  await svc.record({ businessId: "b", actor: pharmacist, action: "prescription.approve", target: "RX-309", detail: { orderCode: "PED-4809" } });
  assert.equal(created[0].category, "Receita");
  assert.equal(created[0].memberName, "Paulo");
  assert.equal(categoryForAction("team.invite"), "Equipe");
  assert.equal(categoryForAction("something.else"), "Outros");
  const boom: any = { client: { accessLogEntry: { create: async () => { throw new Error("db down"); } } } };
  await new AccessLogService(boom).record({ businessId: "b", action: "auth.login" }); // must not throw
});

// ---------- member context / login ----------

test("owner role permissions are canonical regardless of what is stored", () => {
  const svc = new MemberContextService({} as any, {} as any);
  const ctx = svc.toContext({
    id: "m", businessId: "b", name: "Maria", email: null, crf: null, roleId: "r",
    role: { key: "owner", name: "Proprietário", requiresCrf: false, ownDeliveriesOnly: false, permissions: { pedidos: "none" } },
    business: { niche: "farmacia" },
  });
  assert.equal(ctx.permissions.pedidos, "edit");
  assert.equal(ctx.permissions.equipe, "edit");
});

function fakeMember(over: any = {}) {
  return {
    id: "m1", businessId: "b1", email: "paulo@x.com", name: "Paulo", phone: null, crf: "CRF-PR 1", roleId: "r1", status: "active",
    passwordHash: bcrypt.hashSync("senha-segura-1", 4),
    role: { key: "pharmacist", name: "Farmacêutico RT", requiresCrf: true, ownDeliveriesOnly: false, permissions: buildStarterPermissions("farmacia", "pharmacist") },
    business: { id: "b1", slug: "farm", name: "Farmácia", niche: "farmacia" },
    ...over,
  };
}
function authService(members: any[]) {
  const updates: any[] = [];
  const prisma: any = {
    client: {
      businessMember: {
        findMany: async ({ where }: any) => members.filter((m) => m.email === where.email && m.status === "active" && (!where.business || m.business.slug === where.business.slug)),
        update: async (a: any) => updates.push(a),
      },
      accessLogEntry: { create: async () => {} },
    },
  };
  const log = new AccessLogService(prisma);
  return { svc: new MemberAuthService(prisma, new MemberContextService(prisma, {} as any), log), updates };
}

test("member login: success carries memberId, roleKey and permissions in the JWT", async () => {
  const { svc, updates } = authService([fakeMember()]);
  const { token, ctx } = await svc.loginWithPassword(" Paulo@X.com ", "senha-segura-1");
  const claims = await verifyBusinessSession(token);
  assert.equal(claims.memberId, "m1");
  assert.equal(claims.roleKey, "pharmacist");
  assert.equal(claims.businessId, "b1");
  assert.equal(claims.permissions?.receitas, "edit");
  assert.equal(ctx.permissions.classes, "edit");
  assert.equal(updates.length, 1);
});

test("member login: wrong password / unknown email / disabled are all the same 401", async () => {
  const { svc } = authService([fakeMember(), fakeMember({ id: "m2", email: "off@x.com", status: "disabled" })]);
  for (const [email, pw] of [["paulo@x.com", "errada-errada"], ["ninguem@x.com", "senha-segura-1"], ["off@x.com", "senha-segura-1"]]) {
    await assert.rejects(svc.loginWithPassword(email, pw), (e: any) => e.getStatus() === 401);
  }
});

test("member login: same email+password in two businesses requires businessSlug", async () => {
  const a = fakeMember();
  const b = fakeMember({ id: "m9", businessId: "b2", business: { id: "b2", slug: "outra", name: "Outra", niche: "farmacia" } });
  const { svc } = authService([a, b]);
  await assert.rejects(svc.loginWithPassword("paulo@x.com", "senha-segura-1"), (e: any) => e.getStatus() === 409 && e.getResponse().code === "BUSINESS_AMBIGUOUS" && e.getResponse().businesses.length === 2);
  const ok = await svc.loginWithPassword("paulo@x.com", "senha-segura-1", "outra");
  assert.equal(ok.ctx.businessId, "b2");
});

test("migration backfill SQL stays in sync with the starter grids in packages/shared", () => {
  const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const dir = join(__dirname, "..", "..", "..", "packages", "db", "prisma", "migrations");
  const migs = readdirSync(dir).filter((d: string) => d.includes("pharmacy_"));
  const sql = migs.map((m: string) => readFileSync(join(dir, m, "migration.sql"), "utf8")).join("\n");
  for (const niche of ["imobiliaria", "concessionaria", "farmacia"] as const) {
    for (const key of starterRoleKeysForNiche(niche)) {
      assert.ok(sql.includes(JSON.stringify(buildStarterPermissions(niche, key))), `${niche}/${key} grid drifted from the migration backfill`);
    }
  }
});
