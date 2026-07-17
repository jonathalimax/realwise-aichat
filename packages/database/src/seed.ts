import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createDatabase, channelConnections, knowledgeSources, memberships, tenants, users } from "./index";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = createDatabase(databaseUrl);
const now = new Date();

const [user] = await db.insert(users).values({
  email: "owner@realwise.local",
  name: "Owner Demo",
  passwordHash: hashSeedPassword("change-me-demo-password"),
  emailVerifiedAt: now,
}).returning();

const [tenant] = await db.insert(tenants).values({
  name: "Academia Realwise Demo",
  segment: "Academia e artes marciais",
  releaseState: "MOCK_VERIFIED",
}).returning();

if (!user || !tenant) throw new Error("Failed to seed user/tenant");

await db.insert(memberships).values({ tenantId: tenant.id, userId: user.id, role: "OWNER" });
await db.insert(channelConnections).values([
  { tenantId: tenant.id, provider: "WHATSAPP", status: "CONNECTED", releaseState: "MOCK_VERIFIED" },
  { tenantId: tenant.id, provider: "INSTAGRAM", status: "CONNECTED", releaseState: "MOCK_VERIFIED" },
  { tenantId: tenant.id, provider: "FACEBOOK", status: "ACTION_REQUIRED", releaseState: "MOCK_VERIFIED" },
]);
await db.insert(knowledgeSources).values([
  { tenantId: tenant.id, title: "Horários de atendimento", kind: "BUSINESS_PROFILE", body: "Segunda a sexta, das 6h às 22h. Sábado das 8h às 13h.", releaseState: "MOCK_VERIFIED" },
  { tenantId: tenant.id, title: "Planos e preços", kind: "FAQ", body: "Plano mensal a partir de R$ 149. Aula experimental deve ser confirmada pela equipe.", releaseState: "MOCK_VERIFIED" },
]);

console.log(JSON.stringify({ seeded: true, userId: user.id, tenantId: tenant.id }));

function hashSeedPassword(password: string): string {
  const iterations = 210_000;
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2-sha256$${iterations}$${salt}$${hash}`;
}
