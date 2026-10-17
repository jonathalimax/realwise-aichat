import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AdminOnboardingService } from "../src/modules/admin/admin-onboarding.service";

process.env.DASHBOARD_URL = "https://aichat.example.com";

function setup(opts: { existingOwnerEmail?: string; owner?: any } = {}) {
  const businesses: any[] = [];
  const members: any[] = opts.owner ? [opts.owner] : [];
  const invites: any[] = [];
  const rolesEnsured: any[] = [];
  const prisma: any = {
    client: {
      business: {
        create: async ({ data }: any) => { const b = { id: `b${businesses.length}`, ...data }; businesses.push(b); return b; },
        findUnique: async ({ where }: any) => businesses.find((b) => b.id === where.id) ?? (where.id === "existing" ? { id: "existing", name: "Imob", niche: "imobiliaria", ownerName: "Ana", email: null } : null),
        update: async () => ({}),
      },
      businessMember: {
        findFirst: async ({ where }: any) => {
          if (where.role?.key === "owner" && where.email) return members.find((m) => m.email === where.email && m.roleKey === "owner") ?? (opts.existingOwnerEmail === where.email ? { id: "x" } : null);
          if (where.role?.key === "owner") return members.find((m) => m.businessId === where.businessId) ?? null;
          return null;
        },
        create: async ({ data }: any) => { const m = { id: `m${members.length}`, roleKey: "owner", ...data }; members.push(m); return m; },
        update: async ({ where, data }: any) => Object.assign(members.find((m) => m.id === where.id), data),
      },
      role: { findUniqueOrThrow: async () => ({ id: "role-owner", key: "owner" }) },
      memberInvite: { updateMany: async () => ({ count: 0 }), create: async ({ data }: any) => { invites.push(data); return data; } },
      $transaction: async (ops: any[]) => Promise.all(ops),
    },
  };
  const starter: any = { ensureRolesOnly: async (id: string, niche: string) => rolesEnsured.push([id, niche]) };
  return { service: new AdminOnboardingService(prisma, starter), businesses, members, invites, rolesEnsured };
}

for (const niche of ["imobiliaria", "farmacia", "concessionaria"] as const) {
  test(`createBusiness (${niche}): no phone, owner invited by e-mail, link under the niche prefix`, async () => {
    const { service, businesses, members, invites, rolesEnsured } = setup();
    const res: any = await service.createBusiness({ niche, businessName: "Exemplo", ownerName: "Maria", email: " Maria@Exemplo.com " });
    assert.equal(businesses[0].phone, null);
    assert.equal(businesses[0].status, "onboarding");
    assert.equal(businesses[0].niche, niche);
    assert.deepEqual(rolesEnsured[0], ["b0", niche]);
    assert.equal(members[0].email, "maria@exemplo.com");
    assert.equal(members[0].status, "invited");
    assert.equal(invites[0].kind, "invite");
    assert.ok(invites[0].expiresAt.getTime() > Date.now() + 6 * 24 * 3600 * 1000);
    // no RESEND key in tests: the link is returned for the admin to copy
    assert.match(res.inviteUrl, new RegExp(`^https://aichat\\.example\\.com/${niche}/app/convite/[0-9a-f]{64}$`));
    assert.equal(invites[0].tokenHash.length, 64);
    assert.ok(!res.inviteUrl.includes(invites[0].tokenHash), "only the hash is stored");
  });
}

test("createBusiness validates input and refuses an e-mail that already owns a business", async () => {
  const { service } = setup({ existingOwnerEmail: "dup@x.com" });
  await assert.rejects(service.createBusiness({ niche: "outro", businessName: "A B", ownerName: "Maria", email: "a@b.com" }), /INVALID_NICHE|tipo de neg/);
  await assert.rejects(service.createBusiness({ niche: "farmacia", businessName: "A", ownerName: "Maria", email: "a@b.com" }));
  await assert.rejects(service.createBusiness({ niche: "farmacia", businessName: "Farm", ownerName: "", email: "a@b.com" }));
  await assert.rejects(service.createBusiness({ niche: "farmacia", businessName: "Farm", ownerName: "Maria", email: "not-an-email" }));
  await assert.rejects(service.createBusiness({ niche: "farmacia", businessName: "Farm", ownerName: "Maria", email: "dup@x.com" }), /já é proprietário/);
});

test("sendOwnerAccess for a phone-created owner (active, no e-mail) needs an e-mail and sends a password-setup link", async () => {
  const owner = { id: "m0", businessId: "existing", roleKey: "owner", roleId: "r", role: { key: "owner" }, status: "active", email: null, name: "Ana", createdAt: new Date() };
  const { service, invites } = setup({ owner });
  await assert.rejects(service.sendOwnerAccess("existing"), /e-mail/i);
  const res: any = await service.sendOwnerAccess("existing", "Ana@Imob.com");
  assert.equal(res.kind, "password_reset");
  assert.equal(res.email, "ana@imob.com");
  assert.equal(invites[0].kind, "password_reset");
  assert.match(res.url, /^https:\/\/aichat\.example\.com\/imobiliaria\/app\/redefinir-senha\?token=[0-9a-f]{64}$/);
  await assert.rejects(service.sendOwnerAccess("nope"), /não encontrado/i);
});

test("sendOwnerAccess for a pending (invited) owner re-sends the invite link", async () => {
  const owner = { id: "m0", businessId: "existing", roleKey: "owner", roleId: "r", role: { key: "owner" }, status: "invited", email: "ana@imob.com", name: "Ana", createdAt: new Date() };
  const { service, invites } = setup({ owner });
  const res: any = await service.sendOwnerAccess("existing");
  assert.equal(res.kind, "invite");
  assert.equal(invites[0].kind, "invite");
  assert.match(res.url, /\/imobiliaria\/app\/convite\//);
});
