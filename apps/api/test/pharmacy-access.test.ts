import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Reflector } from "@nestjs/core";
import { buildStarterPermissions, hasPermission, STARTER_ROLE_DEFS, type PermissionSection, type StarterRoleKey } from "@realwise/shared";
import { PermissionsGuard } from "../src/modules/access/permissions.guard";
import { REQUIRE_CRF_KEY, REQUIRE_PERMISSION_KEY, type RequiredPermission } from "../src/modules/access/permission.decorator";
import type { MemberContext } from "../src/modules/access/member-context";
import { hasCrfOnFile } from "../src/modules/access/team-rules";
import { OrdersController } from "../src/modules/orders/orders.controller";
import { ProductsController, ClassReviewController } from "../src/modules/products/products.controller";
import { CatalogImportController } from "../src/modules/catalog-import/catalog-import.controller";
import { PrescriptionsController } from "../src/modules/prescriptions/prescriptions.controller";
import { HandoffsController } from "../src/modules/handoffs/handoffs.controller";
import { CustomersAdminController } from "../src/modules/customers/customers-admin.controller";
import { PharmacySettingsController } from "../src/modules/pharmacy-settings/pharmacy-settings.controller";
import { TeamController } from "../src/modules/team/team.controller";
import { DashboardSummaryController, PharmacyAnalyticsController } from "../src/modules/pharmacy-dashboard/pharmacy-dashboard.controller";
import {
  OPEN_RETENTION_CAP_DAYS,
  computeRetentionDeleteAt,
  evaluateRxAccess,
  isBriefExpired,
  isPurgeDue,
  retentionLabel,
} from "../src/modules/prescriptions/retention";
import { PURGED_SUMMARY, PrescriptionsService } from "../src/modules/prescriptions/prescriptions.service";
import { putFile } from "../src/modules/pharmacy-common/storage";
import { sniffFileType, resolveStoragePath } from "../src/modules/pharmacy-common/storage";

// ---------------------------------------------------------------- route <-> permission matrix (API.md)

type Row = [controller: Function, method: string, section: PermissionSection, level: "view" | "edit", crf: boolean];
const ROUTES: Row[] = [
  [OrdersController, "list", "pedidos", "view", false],
  [OrdersController, "get", "pedidos", "view", false],
  [OrdersController, "couriers", "pedidos", "view", false],
  [OrdersController, "confirm", "pedidos", "edit", false],
  [OrdersController, "out", "pedidos", "edit", false],
  [OrdersController, "done", "pedidos", "edit", false],
  [OrdersController, "cancel", "pedidos", "edit", false],
  [OrdersController, "courier", "pedidos", "edit", false],
  [PrescriptionsController, "list", "receitas", "view", false],
  [PrescriptionsController, "get", "receitas", "view", false],
  [PrescriptionsController, "file", "receitas", "view", false],
  [PrescriptionsController, "approve", "receitas", "edit", true],
  [PrescriptionsController, "reject", "receitas", "edit", true],
  [HandoffsController, "list", "atendimento", "view", false],
  [HandoffsController, "get", "atendimento", "view", false],
  [HandoffsController, "reply", "atendimento", "edit", true],
  [HandoffsController, "close", "atendimento", "edit", true],
  [HandoffsController, "whatsappDraft", "atendimento", "edit", true],
  [HandoffsController, "start", "atendimento", "edit", true],
  [HandoffsController, "markAnswered", "atendimento", "edit", true],
  [ProductsController, "list", "catalogo", "view", false],
  [ProductsController, "get", "catalogo", "view", false],
  [ProductsController, "create", "catalogo", "edit", false],
  [ProductsController, "update", "catalogo", "edit", false],
  [ProductsController, "uploadImage", "catalogo", "edit", false],
  [ProductsController, "removeImage", "catalogo", "edit", false],
  [ProductsController, "setClass", "classes", "edit", true],
  [ClassReviewController, "overview", "classes", "view", false],
  [ClassReviewController, "groupProducts", "classes", "view", false],
  [ClassReviewController, "confirm", "classes", "edit", true],
  [CatalogImportController, "upload", "importar", "edit", false],
  [CatalogImportController, "list", "importar", "view", false],
  [CatalogImportController, "get", "importar", "view", false],
  [CatalogImportController, "mapping", "importar", "edit", false],
  [CatalogImportController, "classProposals", "importar", "view", false],
  [CatalogImportController, "apply", "importar", "edit", false],
  [CustomersAdminController, "list", "clientes", "view", false],
  [CustomersAdminController, "get", "clientes", "view", false],
  [PharmacySettingsController, "get", "farmacia", "view", false],
  [PharmacySettingsController, "put", "farmacia", "edit", false],
  [PharmacySettingsController, "confirm", "farmacia", "edit", false],
  [PharmacySettingsController, "dismiss", "farmacia", "edit", false],
  [TeamController, "list", "equipe", "view", false],
  [TeamController, "invite", "equipe", "edit", false],
  [TeamController, "resend", "equipe", "edit", false],
  [TeamController, "update", "equipe", "edit", false],
  [TeamController, "disable", "equipe", "edit", false],
  [TeamController, "enable", "equipe", "edit", false],
  [TeamController, "remove", "equipe", "edit", false],
  [TeamController, "roles", "equipe", "view", false],
  [TeamController, "sections", "equipe", "view", false],
  [TeamController, "createRole", "equipe", "edit", false],
  [TeamController, "updateRole", "equipe", "edit", false],
  [TeamController, "deleteRole", "equipe", "edit", false],
  [TeamController, "accessLog", "equipe", "view", false],
  [DashboardSummaryController, "summary", "inicio", "view", false],
  [PharmacyAnalyticsController, "overview", "analises", "view", false],
];

const reflector = new Reflector();
function metaFor(cls: Function, method: string) {
  const handler = (cls as any).prototype[method];
  assert.equal(typeof handler, "function", `${cls.name}.${method} exists`);
  const required = reflector.getAllAndOverride<RequiredPermission | undefined>(REQUIRE_PERMISSION_KEY, [handler, cls]);
  const crf = !!reflector.getAllAndOverride<boolean | undefined>(REQUIRE_CRF_KEY, [handler, cls]);
  return { handler, required, crf };
}

function memberOf(key: StarterRoleKey, crf: string | null = null): MemberContext {
  const d = STARTER_ROLE_DEFS[key];
  return {
    memberId: `m-${key}`,
    businessId: "b1",
    niche: "farmacia",
    name: key,
    email: null,
    crf,
    roleId: `r-${key}`,
    roleKey: key,
    roleName: d.name,
    requiresCrf: d.requiresCrf,
    ownDeliveriesOnly: d.ownDeliveriesOnly,
    permissions: buildStarterPermissions("farmacia", key),
  };
}
function runGuard(cls: Function, method: string, member: MemberContext): "allow" | { code: string } {
  const guard = new PermissionsGuard(reflector);
  const ctx: any = { getHandler: () => (cls as any).prototype[method], getClass: () => cls, switchToHttp: () => ({ getRequest: () => ({ member }) }) };
  try {
    guard.canActivate(ctx);
    return "allow";
  } catch (e: any) {
    return { code: e.getResponse().code };
  }
}

test("every pharmacy route declares exactly the permission API.md lists (and CRF where required)", () => {
  for (const [cls, method, section, level, crf] of ROUTES) {
    const m = metaFor(cls, method);
    assert.ok(m.required, `${cls.name}.${method} has @RequirePermission`);
    assert.deepEqual(m.required!.sections, [section], `${cls.name}.${method} section`);
    assert.equal(m.required!.level, level, `${cls.name}.${method} level`);
    assert.equal(m.crf, crf, `${cls.name}.${method} CRF`);
  }
});

test("guard matrix: each starter role is allowed iff its grid grants the section (and CRF holds)", () => {
  const keys: StarterRoleKey[] = ["owner", "pharmacist", "manager", "attendant", "courier"];
  let checked = 0;
  for (const [cls, method, section, level, crf] of ROUTES) {
    for (const key of keys) {
      const withCrf = key === "pharmacist" ? "CRF-PR 1234" : null;
      const member = memberOf(key, withCrf);
      const expectAllow = hasPermission(member.permissions, section, level) && (!crf || (member.requiresCrf && hasCrfOnFile(member.crf)));
      const got = runGuard(cls, method, member);
      assert.equal(got === "allow", expectAllow, `${cls.name}.${method} as ${key}: ${JSON.stringify(got)}`);
      if (got !== "allow") assert.ok(["PERMISSION_DENIED", "CRF_REQUIRED"].includes(got.code));
      checked++;
    }
  }
  assert.ok(checked > 250);
});

test("a role lacking the section is denied with PERMISSION_DENIED; a pharmacist role without a CRF number with CRF_REQUIRED", () => {
  assert.deepEqual(runGuard(CatalogImportController, "upload", memberOf("attendant")), { code: "PERMISSION_DENIED" });
  assert.deepEqual(runGuard(ProductsController, "list", memberOf("courier")), { code: "PERMISSION_DENIED" });
  assert.deepEqual(runGuard(TeamController, "invite", memberOf("pharmacist", "CRF-PR 1")), { code: "PERMISSION_DENIED" });
  assert.deepEqual(runGuard(PrescriptionsController, "approve", memberOf("pharmacist", null)), { code: "CRF_REQUIRED" });
  assert.deepEqual(runGuard(PrescriptionsController, "approve", memberOf("pharmacist", "  ")), { code: "CRF_REQUIRED" });
  assert.equal(runGuard(PrescriptionsController, "approve", memberOf("pharmacist", "CRF-PR 1234")), "allow");
  // an Owner / Manager cannot approve prescriptions or confirm classes: those are pharmacist actions
  assert.notEqual(runGuard(PrescriptionsController, "approve", memberOf("owner")), "allow");
  assert.notEqual(runGuard(ClassReviewController, "confirm", memberOf("manager")), "allow");
  assert.notEqual(runGuard(HandoffsController, "reply", memberOf("owner")), "allow");
  // a custom role flagged requiresCrf whose member has no CRF yet is also denied
  const custom = { ...memberOf("attendant"), requiresCrf: true, crf: null, permissions: { ...buildStarterPermissions("farmacia", "pharmacist") } };
  assert.deepEqual(runGuard(PrescriptionsController, "approve", custom), { code: "CRF_REQUIRED" });
});

test("the courier role never reaches catalog, customers, settings or team routes", () => {
  const courier = memberOf("courier");
  for (const [cls, method] of ROUTES) {
    if (cls === OrdersController) continue;
    assert.notEqual(runGuard(cls, method, courier), "allow", `${cls.name}.${method}`);
  }
  // orders are reachable (scoping happens in the service)
  assert.equal(runGuard(OrdersController, "done", courier), "allow");
});

// ---------------------------------------------------------------- prescription retention

test("retention: closed order -> max(closedAt, reviewedAt) + days; open order -> upload + 90 days cap", () => {
  const uploaded = new Date("2026-10-01T00:00:00Z");
  const closed = new Date("2026-10-10T00:00:00Z");
  const reviewedLater = new Date("2026-10-12T00:00:00Z");
  assert.equal(computeRetentionDeleteAt({ uploadedAt: uploaded, closedAt: closed, reviewedAt: new Date("2026-10-05T00:00:00Z"), retentionDays: 30 }).toISOString(), "2026-11-09T00:00:00.000Z");
  assert.equal(computeRetentionDeleteAt({ uploadedAt: uploaded, closedAt: closed, reviewedAt: reviewedLater, retentionDays: 30 }).toISOString(), "2026-11-11T00:00:00.000Z");
  assert.equal(computeRetentionDeleteAt({ uploadedAt: uploaded, closedAt: closed, retentionDays: 7 }).toISOString(), "2026-10-17T00:00:00.000Z");
  const open = computeRetentionDeleteAt({ uploadedAt: uploaded, retentionDays: 30 });
  assert.equal((open.getTime() - uploaded.getTime()) / 86400000, OPEN_RETENTION_CAP_DAYS);
  assert.equal(OPEN_RETENTION_CAP_DAYS, 90);
});

test("retention: purge due / label / brief expiry", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  assert.equal(isPurgeDue({ retentionDeleteAt: new Date(now - 1), fileDeletedAt: null }, now), true);
  assert.equal(isPurgeDue({ retentionDeleteAt: new Date(now), fileDeletedAt: null }, now), true);
  assert.equal(isPurgeDue({ retentionDeleteAt: new Date(now + 1), fileDeletedAt: null }, now), false);
  assert.equal(isPurgeDue({ retentionDeleteAt: new Date(now - 1), fileDeletedAt: new Date() }, now), false, "already purged");
  assert.equal(isPurgeDue({ retentionDeleteAt: null, fileDeletedAt: null }, now), false);
  assert.equal(retentionLabel({ retentionDeleteAt: new Date("2026-11-12T10:00:00Z"), fileDeletedAt: null }), "Apagada em 12 nov 2026");
  assert.equal(retentionLabel({ retentionDeleteAt: null, fileDeletedAt: new Date() }), "Arquivo apagado");
  assert.equal(isBriefExpired({ retentionDeleteAt: new Date(now - 5) }, now), true);
  assert.equal(isBriefExpired({ retentionDeleteAt: null }, now), false);
});

// ---------------------------------------------------------------- prescription access control

test("evaluateRxAccess: other business is not_found, no permission denied, purged is gone", () => {
  const perms = buildStarterPermissions("farmacia", "attendant");
  const rx = { businessId: "b1", fileDeletedAt: null };
  assert.equal(evaluateRxAccess({ businessId: "b1", permissions: perms }, rx), "ok");
  assert.equal(evaluateRxAccess({ businessId: "b2", permissions: perms }, rx), "not_found");
  assert.equal(evaluateRxAccess({ businessId: "b1", permissions: buildStarterPermissions("farmacia", "courier") }, rx), "denied");
  assert.equal(evaluateRxAccess({ businessId: "b1", permissions: perms }, { businessId: "b1", fileDeletedAt: new Date() }), "purged");
  assert.equal(evaluateRxAccess(null, rx), "not_found");
  assert.equal(evaluateRxAccess({ businessId: "b1", permissions: perms }, null), "not_found");
  // cross-business wins over purged/permission: never reveals that the row exists
  assert.equal(evaluateRxAccess({ businessId: "b2", permissions: buildStarterPermissions("farmacia", "courier") }, { businessId: "b1", fileDeletedAt: new Date() }), "not_found");
});

function fakeRxService(rows: any[]) {
  const logs: any[] = [];
  const prisma: any = {
    client: {
      prescriptionUpload: {
        findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
        findMany: async ({ where }: any) => rows.filter((r) => !r.fileDeletedAt && r.retentionDeleteAt && r.retentionDeleteAt <= where.retentionDeleteAt.lte),
        update: async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data),
      },
      pharmacistHandoff: {
        updateMany: async ({ where, data }: any) => {
          const matched = handoffs.filter((h) => h.retentionDeleteAt <= where.retentionDeleteAt.lte && h.summary !== PURGED_SUMMARY);
          matched.forEach((h) => Object.assign(h, data));
          return { count: matched.length };
        },
      },
    },
  };
  const handoffs: any[] = [];
  const service = new PrescriptionsService(prisma, { record: async (e: any) => logs.push(e) } as any, {} as any, {} as any, {} as any);
  return { service, logs, handoffs };
}

test("PrescriptionsService.file: access-checked, logged, 410 once purged, 404 for another business", async () => {
  process.env.LOCAL_STORAGE_DIR = mkdtempSync(join(tmpdir(), "rw-rx-"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await putFile("private/prescriptions/b1/a.png", png);
  const rows = [
    { id: "rx1", businessId: "b1", number: 309, storageKey: "private/prescriptions/b1/a.png", mimeType: "image/png", fileDeletedAt: null, order: { code: "PED-4809" } },
    { id: "rx2", businessId: "b1", number: 310, storageKey: "private/prescriptions/b1/gone.png", mimeType: "image/png", fileDeletedAt: new Date(), order: null },
  ];
  const { service, logs } = fakeRxService(rows);
  const att = memberOf("attendant");
  const file = await service.file(att, "rx1");
  assert.equal(file.mime, "image/png");
  assert.ok(file.data.equals(png));
  assert.equal(logs[0].action, "prescription.download");
  assert.equal(logs[0].target, "RX-309");
  assert.equal(logs[0].summary, "Abriu a receita RX-309 do pedido PED-4809");
  await assert.rejects(() => service.file({ ...att, businessId: "b2" }, "rx1"), (e: any) => e.getStatus() === 404);
  await assert.rejects(() => service.file(memberOf("courier"), "rx1"), (e: any) => e.getStatus() === 403);
  await assert.rejects(() => service.file(att, "rx2"), (e: any) => e.getStatus() === 410 && e.getResponse().code === "PRESCRIPTION_PURGED");
  await assert.rejects(() => service.file(att, "nope"), (e: any) => e.getStatus() === 404);
  assert.equal(logs.length, 1, "denied / missing / purged requests are not logged as downloads");
});

test("retention purge job: deletes due files, keeps the row, blanks expired briefs, counts only", async () => {
  process.env.LOCAL_STORAGE_DIR = mkdtempSync(join(tmpdir(), "rw-rx-"));
  const key = "private/prescriptions/b1/old.png";
  await putFile(key, Buffer.from("x".repeat(64)));
  await putFile("private/prescriptions/b1/new.png", Buffer.from("x".repeat(64)));
  const now = Date.now();
  const rows = [
    { id: "old", businessId: "b1", storageKey: key, retentionDeleteAt: new Date(now - 1000), fileDeletedAt: null, status: "approved", number: 1 },
    { id: "new", businessId: "b1", storageKey: "private/prescriptions/b1/new.png", retentionDeleteAt: new Date(now + 86400000), fileDeletedAt: null, status: "pending", number: 2 },
  ];
  const { service, handoffs } = fakeRxService(rows);
  handoffs.push({ id: "h1", retentionDeleteAt: new Date(now - 1000), summary: "Dor de cabeça", brief: { symptoms: "x" }, answerText: "resp" }, { id: "h2", retentionDeleteAt: new Date(now + 1e9), summary: "Tosse", brief: { symptoms: "y" }, answerText: null });
  const res = await service.runRetentionPurge(now);
  assert.deepEqual(res, { filesDeleted: 1, fileErrors: 0, briefsCleared: 1 });
  assert.ok(rows[0].fileDeletedAt instanceof Date, "row kept, marked purged");
  assert.equal(rows[0].status, "approved");
  assert.equal(rows[1].fileDeletedAt, null);
  assert.equal(existsSync(resolveStoragePath(key)), false, "file really deleted");
  assert.equal(existsSync(resolveStoragePath("private/prescriptions/b1/new.png")), true);
  assert.deepEqual(handoffs[0].brief, {});
  assert.equal(handoffs[0].summary, PURGED_SUMMARY);
  assert.equal(handoffs[0].answerText, null);
  assert.deepEqual(handoffs[1].brief, { symptoms: "y" });
  // second run is a no-op
  assert.deepEqual(await service.runRetentionPurge(now), { filesDeleted: 0, fileErrors: 0, briefsCleared: 0 });
});

// ---------------------------------------------------------------- storage safety

test("storage: keys cannot escape the root; file types come from bytes, not the client", () => {
  process.env.LOCAL_STORAGE_DIR = mkdtempSync(join(tmpdir(), "rw-st-"));
  assert.throws(() => resolveStoragePath("../etc/passwd"));
  assert.throws(() => resolveStoragePath("/etc/passwd"));
  assert.throws(() => resolveStoragePath("a/../../b"));
  assert.doesNotThrow(() => resolveStoragePath("private/prescriptions/b1/x.png"));
  assert.equal(sniffFileType(Buffer.from("%PDF-1.7 xxxxxxxxxxxxx"))?.mime, "application/pdf");
  assert.equal(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime, "image/jpeg");
  assert.equal(sniffFileType(Buffer.from("<html><script>alert(1)</script></html>")), null);
  assert.equal(sniffFileType(Buffer.from("MZ" + "x".repeat(40))), null);
});

test("starter role defs used by the matrix are the documented ones", () => {
  assert.equal(STARTER_ROLE_DEFS.pharmacist.requiresCrf, true);
  assert.equal(STARTER_ROLE_DEFS.courier.ownDeliveriesOnly, true);
});
