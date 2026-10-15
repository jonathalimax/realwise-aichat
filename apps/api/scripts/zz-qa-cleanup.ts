/**
 * LOCAL-ONLY cleanup of QA test data (prefix "zz-qa") in the demo pharmacy.
 *
 *   pnpm --filter @realwise/api exec tsx scripts/zz-qa-cleanup.ts            dry run: prints what would be removed
 *   pnpm --filter @realwise/api exec tsx scripts/zz-qa-cleanup.ts --apply    removes it
 *
 * Removes, for the "farmacia-exemplo" business only: customers (leads) whose name starts with "zz-qa" with their
 * conversations, messages, orders (items, status events, prescription rows), addresses and push subscriptions;
 * products whose name starts with "zz-qa" or whose SKU is A100..A108 (sample sheet B) when no real order uses them;
 * catalog imports named "zz-qa*" (and sample-B imports left without products); team members named "zz-qa*"
 * (with invites); access-log rows that mention "zz-qa". Never touches anything else.
 *
 * Refuses to run unless DATABASE_URL points at localhost / 127.0.0.1 / ::1 (and never in production).
 */
import { prisma } from "@realwise/db";

const SLUG = "farmacia-exemplo";

function assertLocal() {
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname.replace(/^\[|\]$/g, "");
  } catch {
    /* handled below */
  }
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(`Refusing to run: DATABASE_URL host is "${host || "unparseable"}", not localhost (or NODE_ENV=production). This script is local-only.`);
    process.exit(1);
  }
}

async function main() {
  assertLocal();
  const apply = process.argv.includes("--apply");
  const biz = await prisma.business.findFirst({ where: { slug: SLUG, niche: "farmacia" }, select: { id: true } });
  if (!biz) return console.log(`No business with slug ${SLUG}: nothing to do.`);
  const businessId = biz.id;
  const q = async <T = unknown>(sql: string, ...params: unknown[]) => (await prisma.$queryRawUnsafe(sql, ...params)) as T[];
  const x = async (sql: string, ...params: unknown[]) => Number(await prisma.$executeRawUnsafe(sql, ...params));

  const leads = (await q<{ id: string }>(`SELECT id FROM "Lead" WHERE "businessId"=$1 AND name ILIKE 'zz-qa%'`, businessId)).map((r) => r.id);
  const convs = (await q<{ id: string }>(`SELECT id FROM "Conversation" WHERE "businessId"=$1 AND ("leadId" = ANY($2::text[]) OR id IN (SELECT "conversationId" FROM "Order" WHERE "leadId" = ANY($2::text[]) AND "conversationId" IS NOT NULL))`, businessId, leads)).map((r) => r.id);
  const orders = (await q<{ id: string }>(`SELECT id FROM "Order" WHERE "businessId"=$1 AND "leadId" = ANY($2::text[])`, businessId, leads)).map((r) => r.id);
  const members = (await q<{ id: string }>(`SELECT id FROM "BusinessMember" WHERE "businessId"=$1 AND name ILIKE 'zz-qa%'`, businessId)).map((r) => r.id);
  const products = (await q<{ id: string }>(
    `SELECT p.id FROM "Product" p WHERE p."businessId"=$1 AND (p.name ILIKE 'zz-qa%' OR p.sku IN ('A100','A101','A102','A103','A104','A105','A106','A107','A108'))
       AND NOT EXISTS (SELECT 1 FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE i."productId"=p.id AND NOT (o.id = ANY($2::text[])))`,
    businessId,
    orders,
  )).map((r) => r.id);
  console.log({ leads: leads.length, conversations: convs.length, orders: orders.length, members: members.length, products: products.length });
  if (!apply) return console.log("Dry run. Pass --apply to delete.");

  const n: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    const t = async (label: string, sql: string, ...params: unknown[]) => (n[label] = Number(await tx.$executeRawUnsafe(sql, ...params)));
    await t("rx", `DELETE FROM "PrescriptionUpload" WHERE "businessId"=$1 AND ("orderId" = ANY($2::text[]) OR "leadId" = ANY($3::text[]) OR "patientName" ILIKE 'zz-qa%')`, businessId, orders, leads);
    await t("orderItems", `DELETE FROM "OrderItem" WHERE "orderId" = ANY($1::text[]) OR "productId" = ANY($2::text[])`, orders, products);
    await t("orderEvents", `DELETE FROM "OrderStatusEvent" WHERE "orderId" = ANY($1::text[])`, orders);
    await t("orders", `DELETE FROM "Order" WHERE id = ANY($1::text[])`, orders);
    await t("handoffs", `DELETE FROM "PharmacistHandoff" WHERE "businessId"=$1 AND ("leadId" = ANY($2::text[]) OR "conversationId" = ANY($3::text[]))`, businessId, leads, convs);
    await t("push", `DELETE FROM "PushSubscription" WHERE "conversationId" = ANY($1::text[])`, convs);
    await t("messages", `DELETE FROM "Message" WHERE "conversationId" = ANY($1::text[])`, convs);
    await t("conversations", `DELETE FROM "Conversation" WHERE id = ANY($1::text[])`, convs);
    await t("addresses", `DELETE FROM "CustomerAddress" WHERE "leadId" = ANY($1::text[])`, leads);
    await t("leads", `DELETE FROM "Lead" WHERE id = ANY($1::text[])`, leads);
    await t("products", `DELETE FROM "Product" WHERE id = ANY($1::text[])`, products);
    await t("imports", `DELETE FROM "CatalogImport" WHERE "businessId"=$1 AND (filename ILIKE 'zz-qa%' OR (filename ILIKE 'estoque-exemplo-B%' AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."sourceImportId" = "CatalogImport".id)))`, businessId);
    await t("invites", `DELETE FROM "MemberInvite" WHERE "memberId" = ANY($1::text[])`, members);
    await t("members", `DELETE FROM "BusinessMember" WHERE id = ANY($1::text[])`, members);
    await t("accessLog", `DELETE FROM "AccessLogEntry" WHERE "businessId"=$1 AND (target ILIKE '%zz-qa%' OR detail::text ILIKE '%zz-qa%' OR "memberName" ILIKE 'zz-qa%')`, businessId);
  });
  console.log("Removed:", n);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
