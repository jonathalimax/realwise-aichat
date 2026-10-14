/**
 * LOCAL-ONLY demo seed: "Farmácia Exemplo" (niche farmacia) with team, catalog, customers, orders in
 * every status, prescriptions, handoffs, conversations and an access log.
 *
 *   pnpm --filter @realwise/api seed:pharmacy            idempotent: creates what is missing, refreshes stock dates
 *   pnpm --filter @realwise/api seed:pharmacy -- --reset deletes the demo business' own rows first, then recreates
 *
 * Refuses to run unless DATABASE_URL points at localhost / 127.0.0.1 / ::1.
 */
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "crypto";
import { deflateSync } from "zlib";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { prisma } from "@realwise/db";
import { StarterRolesService } from "../src/modules/access/starter-roles.service";
import { dedupKeyFor } from "../src/modules/products/product-utils";
import { DEMO_AREAS, DEMO_CUSTOMERS, DEMO_HOURS, DEMO_MEMBERS, DEMO_PASSWORD, DEMO_PRODUCTS, type DemoProduct } from "./pharmacy-demo-data";

const SLUG = "farmacia-exemplo";
const PHONE = "+5541999990000";

function assertLocal() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    /* handled below */
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(`Refusing to seed: DATABASE_URL host is "${host || "unparseable"}", not localhost. This script is local-only.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- tiny PNG writer (no image dependency)

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
/** A fake prescription sheet: obviously NOT a real prescription (watermark band + "EXEMPLO" bars). */
function fakePrescription(): Buffer {
  return png(480, 640, (x, y) => {
    if (y < 70) return [15, 118, 110];
    if (y > 560 && y < 600 && x > 260 && x < 440) return [60, 60, 60]; // "signature"
    if (y > 120 && y < 520 && y % 36 < 5 && x > 40 && x < 440) return [150, 150, 150]; // text lines
    if ((x + y) % 97 < 3) return [235, 230, 230]; // diagonal "EXEMPLO" texture
    return [252, 252, 250];
  });
}
function productTile(color: string): Buffer {
  const [r, g, b] = hex(color);
  return png(240, 240, (x, y) => {
    const d = Math.hypot(x - 120, y - 120);
    if (d < 38) return [255, 255, 255];
    if (d < 84) return [r, g, b];
    return [Math.round(r + (255 - r) * 0.82), Math.round(g + (255 - g) * 0.82), Math.round(b + (255 - b) * 0.82)];
  });
}

async function put(key: string, data: Buffer) {
  const root = resolve(process.env.LOCAL_STORAGE_DIR ?? "./storage");
  const full = resolve(root, key);
  if (!full.startsWith(root)) throw new Error("bad storage key");
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
}

// ---------------------------------------------------------------- time helpers

const now = Date.now();
const ago = (opts: { d?: number; h?: number; m?: number }) => new Date(now - ((opts.d ?? 0) * 86400 + (opts.h ?? 0) * 3600 + (opts.m ?? 0) * 60) * 1000);

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
void brl;

// ---------------------------------------------------------------- reset

async function resetBusiness(businessId: string) {
  // Every table that carries a businessId (demo chats may have created rows in tables this seed does not know,
  // e.g. unanswered questions, analytics events, usage rows). Foreign keys decide the order: retry in passes.
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'businessId' AND table_name <> 'Business'`,
  )) as Array<{ table_name: string }>;
  let pending = rows.map((r) => r.table_name).filter((t) => /^[A-Za-z]+$/.test(t));
  for (let pass = 0; pass < 8 && pending.length > 0; pass++) {
    const failed: string[] = [];
    for (const table of pending) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "businessId" = $1`, businessId);
      } catch {
        failed.push(table);
      }
    }
    if (failed.length === pending.length) break;
    pending = failed;
  }
  await prisma.business.delete({ where: { id: businessId } });
}

// ---------------------------------------------------------------- main

async function main() {
  assertLocal();
  const reset = process.argv.includes("--reset");
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const existing = await prisma.business.findUnique({ where: { slug: SLUG } });
  if (existing && reset) {
    console.log("--reset: deleting the demo business' rows...");
    await resetBusiness(existing.id);
  }

  // ---- business, roles, members
  let business = await prisma.business.findUnique({ where: { slug: SLUG } });
  if (!business) {
    business = await prisma.business.create({
      data: {
        name: "Farmácia Exemplo",
        slug: SLUG,
        niche: "farmacia",
        phone: PHONE,
        ownerName: "Helena Duarte",
        email: "dono@farmaciaexemplo.test",
        address: "Rua das Flores, 100, Água Verde, Curitiba/PR",
        status: "live",
        publishedAt: new Date(),
        timezone: "America/Sao_Paulo",
        primaryColor: "#0F766E",
        secondaryColor: "#0B4F4A",
        tertiaryColor: "#F59E0B",
        brandColor: "#0F766E",
      },
    });
  }
  const businessId = business.id;
  await new StarterRolesService({ client: prisma } as never).ensureForBusiness(business);
  const roles = await prisma.role.findMany({ where: { businessId } });
  const roleByKey = new Map(roles.map((r) => [r.key as string, r]));

  const memberId: Record<string, string> = {};
  for (const m of DEMO_MEMBERS) {
    const role = roleByKey.get(m.key);
    if (!role) throw new Error(`starter role ${m.key} missing`);
    let row = await prisma.businessMember.findUnique({ where: { businessId_email: { businessId, email: m.email } } });
    if (!row && m.key === "owner") {
      // StarterRolesService created the owner with the business e-mail already (same address): fall through to update.
      row = await prisma.businessMember.findFirst({ where: { businessId, roleId: role.id } });
    }
    if (row) {
      row = await prisma.businessMember.update({ where: { id: row.id }, data: { name: m.name, email: m.email, passwordHash, crf: m.crf, status: "active", roleId: role.id } });
    } else {
      row = await prisma.businessMember.create({ data: { businessId, email: m.email, name: m.name, passwordHash, roleId: role.id, crf: m.crf, status: "active" } });
    }
    memberId[m.key] = row.id;
  }

  // ---- subscription (so /plano has something to show)
  const plan = await prisma.plan.findFirst({ where: { code: "profissional" } });
  if (plan) {
    await prisma.subscription.upsert({
      where: { businessId },
      update: {},
      create: {
        businessId,
        planId: plan.id,
        stripeCustomerId: "cus_local_demo",
        stripeSubscriptionId: "sub_local_demo",
        status: "active",
        currentPeriodStart: ago({ d: 10 }),
        currentPeriodEnd: new Date(now + 20 * 86400_000),
        conversationsUsedThisPeriod: 37,
      },
    });
  }

  // ---- settings
  const settings = await prisma.pharmacySettings.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      legalName: "Farmácia Exemplo Ltda",
      cnpj: "11222333000181",
      afeNumber: "AFE 1.23456.7",
      pharmacistName: "Dra. Carla Menezes",
      pharmacistCrf: "CRF-PR 12345",
      deliveryAreas: DEMO_AREAS,
      deliveryFeeCents: 600,
      minOrderCents: 2500,
      pickupEnabled: true,
      deliveryEnabled: true,
      autoConfirmEnabled: true,
      stockMaxAgeHours: 24,
      openingHours: DEMO_HOURS,
      paymentMethods: ["pix", "cartao", "dinheiro"],
      exchangePolicy: "Trocas em até 7 dias com a embalagem lacrada e a nota fiscal. Medicamentos não são trocados após a entrega.",
      maxQtyPerItemDefault: 5,
      prescriptionRetentionDays: 30,
      orderReminderMinutes: 10,
      quickChips: ["Fazer um pedido", "Falar com o farmacêutico", "Horário de funcionamento", "Taxa de entrega"],
    },
  });

  // ---- import record + products
  const sheetAt = new Date();
  let imp = await prisma.catalogImport.findFirst({ where: { businessId, filename: "estoque-demo.xlsx" } });
  if (!imp) {
    const doc = await prisma.knowledgeDocument.create({
      data: { businessId, filename: "estoque-demo.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 0, storageKey: `catalog/${businessId}/demo-estoque.xlsx`, source: "catalog_import", status: "processed" },
    });
    imp = await prisma.catalogImport.create({
      data: { businessId, documentId: doc.id, filename: "estoque-demo.xlsx", status: "applied", stockAsOf: sheetAt, appliedAt: sheetAt, stats: { created: DEMO_PRODUCTS.length, updated: 0, skipped: 0 } },
    });
  } else {
    await prisma.catalogImport.update({ where: { id: imp.id }, data: { stockAsOf: sheetAt } });
  }
  const productId: Record<string, string> = {};
  for (const d of DEMO_PRODUCTS) {
    const dedupKey = dedupKeyFor({ ean: d.ean, name: d.name, presentation: d.presentation });
    const confirmed = d.cls !== "unclassified";
    const row = await prisma.product.upsert({
      where: { businessId_dedupKey: { businessId, dedupKey } },
      update: { stockAsOf: sheetAt },
      create: {
        businessId,
        ean: d.ean,
        name: d.name,
        activeIngredient: d.ingredient || null,
        presentation: d.presentation,
        manufacturer: d.manufacturer,
        category: d.category,
        priceCents: d.priceCents,
        stockQty: d.stock,
        stockAsOf: sheetAt,
        saleClass: d.cls,
        classProposed: confirmed ? d.cls : (d.proposed?.cls ?? null),
        classProposedBy: confirmed ? (d.cls === "otc" ? "sheet" : "reference") : (d.proposed?.by ?? null),
        classProposedReason: confirmed ? (d.cls === "otc" ? 'coluna "Tarja": Venda livre' : d.cls === "controlled" ? "lista Portaria 344" : "lista tarja vermelha") : (d.proposed?.reason ?? null),
        classConfirmedAt: confirmed ? ago({ d: 2 }) : null,
        classConfirmedBy: confirmed ? memberId.pharmacist : null,
        pharmacistRequired: d.pharmacistRequired ?? false,
        equivalentGroup: d.group ?? null,
        sourceImportId: imp.id,
        dedupKey,
      },
    });
    productId[d.k] = row.id;
    if (d.image && !row.imageKey) {
      const key = `products/${businessId}/${row.id}.png`;
      await put(key, productTile(d.image));
      await prisma.product.update({ where: { id: row.id }, data: { imageKey: key } });
    }
  }
  const P = (k: string) => DEMO_PRODUCTS.find((x) => x.k === k) as DemoProduct;

  // ---- customers + addresses + consent
  const leadId: Record<string, string> = {};
  for (const c of DEMO_CUSTOMERS) {
    const lead = await prisma.lead.upsert({
      where: { businessId_phoneNormalized: { businessId, phoneNormalized: c.phone } },
      update: {},
      create: { businessId, name: c.name, phone: c.phone, phoneNormalized: c.phone, email: c.email, firstSeenAt: ago({ d: 20 }), lastSeenAt: ago({ h: 2 }), status: "new" },
    });
    leadId[c.k] = lead.id;
    const hasAddr = await prisma.customerAddress.findFirst({ where: { businessId, leadId: lead.id } });
    if (!hasAddr) await prisma.customerAddress.create({ data: { businessId, leadId: lead.id, isDefault: true, ...c.address } });
    const hasConsent = await prisma.consentRecord.findFirst({ where: { businessId, leadId: lead.id } });
    if (!hasConsent) {
      await prisma.consentRecord.create({
        data: { businessId, leadId: lead.id, phoneHash: createHash("sha256").update(c.phone).digest("hex"), consentTextVersion: "pharmacy-order-contact-v1", purposes: ["order_contact"], grantedAt: ago({ d: 20 }) },
      });
    }
  }

  // ---- idempotency guard for demo transactional data: ids are fixed, so a rerun skips what exists
  const idOf = (name: string) => `demo-${name}`;
  const addrOf = (k: string) => DEMO_CUSTOMERS.find((c) => c.k === k)!.address;

  type Line = [string, number];
  interface DemoOrder {
    n: number;
    customer: string;
    fulfillment: "delivery" | "pickup";
    status: "pending_pharmacist" | "confirmed" | "out_for_delivery" | "ready_for_pickup" | "delivered" | "canceled" | "rejected";
    lines: Line[];
    at: Date;
    auto?: boolean;
    courier?: boolean;
    rx?: boolean;
    reason?: string;
    swap?: boolean;
    differs?: boolean;
    addr?: ReturnType<typeof addrOf>;
  }
  const ORDERS: DemoOrder[] = [
    { n: 1001, customer: "maria", fulfillment: "delivery", status: "delivered", lines: [["dipirona", 2], ["paracetamol750", 1]], at: ago({ d: 6, h: 3 }), auto: true, courier: true },
    { n: 1002, customer: "joao", fulfillment: "pickup", status: "delivered", lines: [["ibuprofeno", 1], ["eno", 3]], at: ago({ d: 5, h: 2 }), auto: true },
    { n: 1003, customer: "ana", fulfillment: "delivery", status: "delivered", lines: [["loratadina", 1], ["vitc", 1], ["soro", 2]], at: ago({ d: 4, h: 5 }), auto: true, courier: true },
    { n: 1004, customer: "maria", fulfillment: "delivery", status: "delivered", lines: [["vick", 1], ["strepsils", 2]], at: ago({ d: 3, h: 1 }), auto: true, courier: true },
    { n: 1005, customer: "carlos", fulfillment: "delivery", status: "canceled", lines: [["omeprazol", 1]], at: ago({ d: 2, h: 6 }), reason: "Sem estoque", courier: false },
    { n: 1006, customer: "joao", fulfillment: "pickup", status: "delivered", lines: [["dorflex", 2]], at: ago({ d: 1, h: 4 }), auto: true },
    { n: 1007, customer: "ana", fulfillment: "delivery", status: "delivered", lines: [["protetor", 1], ["alcoolgel", 1]], at: ago({ d: 1, h: 2 }), auto: true, courier: true },
    { n: 1008, customer: "ana", fulfillment: "delivery", status: "out_for_delivery", lines: [["amoxicilina", 1], ["paracetamol500", 1]], at: ago({ h: 3 }), rx: true, courier: true },
    { n: 1009, customer: "joao", fulfillment: "pickup", status: "ready_for_pickup", lines: [["cetirizina", 1]], at: ago({ h: 1, m: 10 }), auto: true },
    { n: 1010, customer: "carlos", fulfillment: "delivery", status: "confirmed", lines: [["dipirona", 1], ["curativo", 1]], at: ago({ m: 35 }), auto: true },
    { n: 1011, customer: "maria", fulfillment: "pickup", status: "confirmed", lines: [["termometro", 1], ["alcoolgel", 2]], at: ago({ m: 22 }), auto: true },
    { n: 1012, customer: "ana", fulfillment: "delivery", status: "pending_pharmacist", lines: [["azitromicina", 1]], at: ago({ m: 12 }), rx: true },
    { n: 1013, customer: "carlos", fulfillment: "delivery", status: "pending_pharmacist", lines: [["dipirona", 1]], at: ago({ m: 6 }), swap: true },
    { n: 1014, customer: "beatriz", fulfillment: "delivery", status: "rejected", lines: [["amoxclav", 1]], at: ago({ d: 1, h: 7 }), rx: true, reason: "Receita ilegível" },
    { n: 1015, customer: "beatriz", fulfillment: "delivery", status: "pending_pharmacist", lines: [["paracetamol750", 1]], at: ago({ m: 3 }), differs: true },
  ];

  const nextRx: Record<number, number> = { 1008: 1, 1012: 2, 1014: 3 };
  const rxStatus: Record<number, "approved" | "pending" | "rejected"> = { 1008: "approved", 1012: "pending", 1014: "rejected" };
  const rxImage = fakePrescription();

  for (const o of ORDERS) {
    const id = idOf(`order-${o.n}`);
    if (await prisma.order.findUnique({ where: { id } })) continue;
    const lines = o.lines.map(([k, qty]) => ({ d: P(k), qty }));
    const subtotal = lines.reduce((s, l) => s + l.d.priceCents * l.qty, 0);
    const fee = o.fulfillment === "delivery" ? settings.deliveryFeeCents : 0;
    const conversationId = idOf(`conv-order-${o.n}`);
    const addr = o.fulfillment === "delivery" ? (o.addr ?? addrOf(o.customer)) : null;
    const closed = ["delivered", "canceled", "rejected"].includes(o.status);
    await prisma.conversation.create({
      data: {
        id: conversationId, businessId, leadId: leadId[o.customer], visitorToken: `demo-visitor-${o.n}`, status: closed ? "closed" : "active",
        startedAt: new Date(o.at.getTime() - 8 * 60_000), lastMessageAt: o.at, messageCount: 4, channel: "widget",
      },
    });
    const customer = DEMO_CUSTOMERS.find((c) => c.k === o.customer)!;
    const wanted = lines.map((l) => `${l.qty}x ${l.d.name}`).join(", ");
    const msgs: Array<{ role: string; content: string; at: number }> = [
      { role: "visitor", content: `Oi, quero ${wanted}`, at: -8 },
      { role: "assistant", content: `Oi, ${customer.name.split(" ")[0]}! Sou o Alex, assistente virtual (IA) da Farmácia Exemplo. Coloquei no carrinho: ${wanted}. Posso fechar o pedido?`, at: -7 },
      { role: "visitor", content: "Pode fechar, entrega no meu endereço", at: -5 },
      { role: "assistant", content: `Pedido PED-${o.n} recebido. Acompanhe o status pelo link que enviei.`, at: -1 },
    ];
    for (const m of msgs) {
      await prisma.message.create({ data: { conversationId, businessId, role: m.role, content: m.content, createdAt: new Date(o.at.getTime() + m.at * 60_000) } });
    }
    const status = o.status;
    await prisma.order.create({
      data: {
        id, businessId, leadId: leadId[o.customer], conversationId, number: o.n, code: `PED-${o.n}`,
        statusToken: randomBytes(24).toString("base64url"),
        fulfillment: o.fulfillment, status, subtotalCents: subtotal, deliveryFeeCents: fee, totalCents: subtotal + fee,
        addressSnapshot: addr ?? undefined, addressDiffersFromSaved: Boolean(o.differs),
        notes: o.swap ? "Cliente escolheu um equivalente de produto sem estoque: confirmar com o cliente antes de separar." : null,
        autoConfirmed: Boolean(o.auto), hasPrescription: Boolean(o.rx), stockAsOfSnapshot: ago({ h: 2, d: Math.floor((now - o.at.getTime()) / 86400_000) }),
        statusReason: o.reason ?? null,
        courierMemberId: o.courier ? memberId.courier : null,
        confirmedAt: ["pending_pharmacist", "canceled", "rejected"].includes(status) ? null : new Date(o.at.getTime() + 60_000),
        deliveredAt: status === "delivered" ? new Date(o.at.getTime() + 55 * 60_000) : null,
        canceledAt: status === "canceled" || status === "rejected" ? new Date(o.at.getTime() + 30 * 60_000) : null,
        createdAt: o.at,
        items: {
          create: lines.map((l) => ({
            productId: productId[l.d.k], nameSnapshot: `${l.d.name} · ${l.d.presentation}`, unitPriceCents: l.d.priceCents, qty: l.qty, saleClassSnapshot: l.d.cls,
          })),
        },
      },
    });
    const events: Array<{ from: string | null; to: string; by: string; mid?: string; reason?: string; at: Date }> = [{ from: null, to: "pending_pharmacist", by: "Cliente", at: o.at }];
    const at = (min: number) => new Date(o.at.getTime() + min * 60_000);
    if (o.auto) events.push({ from: "pending_pharmacist", to: "confirmed", by: "Sistema", reason: "Confirmação automática", at: at(1) });
    else if (status !== "pending_pharmacist" && status !== "rejected" && status !== "canceled") events.push({ from: "pending_pharmacist", to: "confirmed", by: "Dra. Carla Menezes", mid: memberId.pharmacist, at: at(6) });
    if (status === "out_for_delivery" || status === "delivered") events.push({ from: "confirmed", to: "out_for_delivery", by: "Marcos Silva", mid: memberId.courier, at: at(25) });
    if (status === "ready_for_pickup") events.push({ from: "confirmed", to: "ready_for_pickup", by: "Camila Torres", mid: memberId.attendant, at: at(20) });
    if (status === "delivered") events.push({ from: o.fulfillment === "delivery" ? "out_for_delivery" : "confirmed", to: "delivered", by: o.fulfillment === "delivery" ? "Marcos Silva" : "Camila Torres", mid: o.fulfillment === "delivery" ? memberId.courier : memberId.attendant, at: at(55) });
    if (status === "canceled") events.push({ from: "pending_pharmacist", to: "canceled", by: "Camila Torres", mid: memberId.attendant, reason: o.reason, at: at(30) });
    if (status === "rejected") events.push({ from: "pending_pharmacist", to: "rejected", by: "Dra. Carla Menezes", mid: memberId.pharmacist, reason: o.reason, at: at(30) });
    for (const e of events) {
      await prisma.orderStatusEvent.create({ data: { orderId: id, businessId, fromStatus: e.from as never, toStatus: e.to as never, byMemberId: e.mid ?? null, byName: e.by, reason: e.reason ?? null, createdAt: e.at } });
    }
    if (o.rx) {
      const number = nextRx[o.n];
      const key = `private/prescriptions/${businessId}/demo-rx-${number}.png`;
      await put(key, rxImage);
      const st = rxStatus[o.n];
      await prisma.prescriptionUpload.create({
        data: {
          id: idOf(`rx-${number}`), businessId, orderId: id, conversationId, leadId: leadId[o.customer], number, storageKey: key, mimeType: "image/png", sizeBytes: rxImage.length,
          patientName: customer.name, status: st,
          reviewedAt: st === "pending" ? null : at(5), reviewedByMemberId: st === "pending" ? null : memberId.pharmacist, reviewedByName: st === "pending" ? null : "Dra. Carla Menezes",
          rejectReason: st === "rejected" ? "Receita ilegível" : null,
          retentionDeleteAt: new Date(now + 30 * 86400_000), createdAt: new Date(o.at.getTime() - 2 * 60_000),
        },
      });
    }
  }

  // ---- conversations + handoffs
  const mkConv = async (name: string, customer: string | null, minsAgo: number, status: "active" | "escalated" | "closed") => {
    const id = idOf(`conv-${name}`);
    if (!(await prisma.conversation.findUnique({ where: { id } }))) {
      await prisma.conversation.create({
        data: { id, businessId, leadId: customer ? leadId[customer] : null, visitorToken: `demo-visitor-${name}`, status, startedAt: ago({ m: minsAgo + 10 }), lastMessageAt: ago({ m: minsAgo }), channel: "widget" },
      });
      return { id, fresh: true };
    }
    return { id, fresh: false };
  };
  const say = async (conversationId: string, role: string, content: string, minsAgo: number, extra: Record<string, unknown> = {}) => {
    await prisma.message.create({ data: { conversationId, businessId, role, content, createdAt: ago({ m: minsAgo }), ...extra } as never });
  };
  const mkHandoff = async (name: string, conversationId: string, data: Record<string, unknown>) => {
    const id = idOf(`handoff-${name}`);
    if (await prisma.pharmacistHandoff.findUnique({ where: { id } })) return;
    await prisma.pharmacistHandoff.create({ data: { id, businessId, conversationId, retentionDeleteAt: new Date(now + 90 * 86400_000), ...data } as never });
  };

  // urgent red flag (open)
  {
    const c = await mkConv("urgente", "joao", 5, "escalated");
    if (c.fresh) {
      await say(c.id, "visitor", "meu pai está com dor forte no peito e falta de ar", 6);
      await say(c.id, "assistant", "Isso pode ser uma emergência. Ligue agora para o SAMU: 192. Também avisei o farmacêutico da farmácia. Não use medicamentos sem orientação.", 6, { uiData: { type: "red_flag" } });
    }
    await mkHandoff("urgente", c.id, {
      leadId: leadId.joao, reason: "symptom", urgent: true, summary: "Possível emergência (sinal de alerta)", status: "open", createdAt: ago({ m: 6 }),
      brief: { symptoms: "Dor no peito e falta de ar", forWhom: { relation: "Pai", age: "68 anos" }, redFlags: ["Dor no peito", "Falta de ar"], customerText: "meu pai está com dor forte no peito e falta de ar", conversationLink: `/conversas?open=${c.id}` },
    });
  }
  // symptom (open) with suggestion
  {
    const c = await mkConv("sintoma", "maria", 18, "escalated");
    if (c.fresh) {
      await say(c.id, "visitor", "estou com dor de cabeça faz 3 dias", 30);
      await say(c.id, "assistant", "Sinto muito. Não posso indicar remédios, mas posso passar suas informações ao farmacêutico, que responde aqui. Vou fazer algumas perguntas rápidas.", 29);
      await say(c.id, "assistant", "Pronto, enviei seu atendimento ao farmacêutico. Ele responde nesta conversa.", 18);
    }
    await mkHandoff("sintoma", c.id, {
      leadId: leadId.maria, reason: "symptom", urgent: false, summary: "Dor de cabeça há 3 dias", status: "open", createdAt: ago({ m: 18 }),
      brief: {
        symptoms: "Dor de cabeça", duration: "3 dias", severity: "Moderada", forWhom: { relation: "Própria pessoa", age: "34 anos", pregnant: false },
        allergies: ["Nenhuma"], otherMedicines: ["Nenhum"], alreadyTried: ["Água e descanso"], redFlags: [],
        suggestedProducts: [{ productId: productId.paracetamol750, name: "Paracetamol 750mg", reason: "analgésico OTC em estoque" }],
        suggestionNote: "Sugestão para o farmacêutico, não enviada ao cliente.", conversationLink: `/conversas?open=${c.id}`,
      },
    });
  }
  // controlled inquiry (open)
  {
    const c = await mkConv("controlado", "carlos", 40, "escalated");
    if (c.fresh) {
      await say(c.id, "visitor", "quero comprar clonazepam 2mg", 41);
      await say(c.id, "assistant", "Clonazepam 2mg: em estoque, R$ 24,90. Esse medicamento é controlado e não vendemos online. Posso chamar o farmacêutico?", 41, { uiData: { type: "controlled_info" } });
    }
    await mkHandoff("controlado", c.id, {
      leadId: leadId.carlos, reason: "controlled", urgent: false, summary: "Consulta sobre medicamento controlado", status: "open", createdAt: ago({ m: 40 }),
      brief: { medication: "Clonazepam 2mg", availability: "Em estoque", priceInformedCents: 2490, onlineSaleAllowed: false, customerRequest: "Cliente quer comprar clonazepam 2mg", conversationLink: `/conversas?open=${c.id}` },
    });
  }
  // answered (human joined banner + owner reply)
  {
    const c = await mkConv("respondido", "ana", 120, "active");
    if (c.fresh) {
      await say(c.id, "visitor", "tosse seca há 4 dias, sem febre", 140);
      await say(c.id, "assistant", "Entendi. Vou passar para o farmacêutico, que responde aqui.", 138);
      await say(c.id, "system", "Dra. Carla Menezes · Farmacêutico RT entrou na conversa", 125, {
        kind: "human_joined", authorMemberId: memberId.pharmacist, authorRole: "Farmacêutico RT", authorName: "Dra. Carla Menezes",
        uiData: { type: "human_joined", name: "Dra. Carla Menezes", roleName: "Farmacêutico RT" },
      });
      await say(c.id, "owner", "Oi, Ana! Para tosse seca sem febre, o ideal é manter hidratação e observar. Se passar de 7 dias ou aparecer febre/falta de ar, procure atendimento médico. Pode passar na farmácia para conversarmos.", 120, {
        authorMemberId: memberId.pharmacist, authorRole: "Farmacêutico RT", authorName: "Dra. Carla Menezes",
      });
    }
    await mkHandoff("respondido", c.id, {
      leadId: leadId.ana, reason: "symptom", urgent: false, summary: "Tosse seca há 4 dias", status: "answered", createdAt: ago({ m: 138 }),
      answerText: "Oi, Ana! Para tosse seca sem febre, o ideal é manter hidratação e observar. Se passar de 7 dias ou aparecer febre/falta de ar, procure atendimento médico.",
      answeredAt: ago({ m: 120 }), answeredByMemberId: memberId.pharmacist, answeredByName: "Dra. Carla Menezes", answeredByRole: "Farmacêutico RT",
      brief: { symptoms: "Tosse seca", duration: "4 dias", severity: "Leve", forWhom: { relation: "Própria pessoa", age: "29 anos", pregnant: false }, allergies: ["Nenhuma"], otherMedicines: ["Nenhum"], alreadyTried: ["Mel com limão"], redFlags: [], conversationLink: `/conversas?open=${c.id}` },
    });
  }
  // out of stock swap (open, tied to order 1013)
  {
    const conv = idOf("conv-order-1013");
    await mkHandoff("troca", conv, {
      leadId: leadId.carlos, reason: "out_of_stock", urgent: false, summary: "Troca de produto sem estoque · PED-1013", status: "open", createdAt: ago({ m: 6 }),
      brief: {
        requestedProduct: "Novalgina 500mg · 10 comprimidos", stock: 0,
        equivalents: [{ productId: productId.dipirona, name: "Dipirona Sódica 500mg · 30 comprimidos" }],
        customerRequest: "Cliente escolheu um equivalente no pedido PED-1013; confirmar a troca.", conversationLink: `/conversas?open=${conv}`,
      },
    });
  }
  // closed
  {
    const c = await mkConv("fechado", "joao", 60 * 26, "closed");
    if (c.fresh) {
      await say(c.id, "visitor", "vocês têm Rinosoro?", 60 * 26 + 2);
      await say(c.id, "assistant", "Rinosoro está sem estoque no momento. Posso avisar o farmacêutico.", 60 * 26 + 1);
    }
    await mkHandoff("fechado", c.id, {
      leadId: leadId.joao, reason: "out_of_stock", urgent: false, summary: "Produto sem estoque: Rinosoro", status: "closed", closedAt: ago({ h: 20 }), createdAt: ago({ m: 60 * 26 }),
      answeredAt: ago({ h: 21 }), answeredByMemberId: memberId.attendant, answeredByName: "Camila Torres", answeredByRole: "Atendente", answerText: "Chega amanhã cedo, avisamos você.",
      brief: { requestedProduct: "Rinosoro 30ml", stock: 0, equivalents: [], customerRequest: "Cliente procura Rinosoro", conversationLink: `/conversas?open=${c.id}` },
    });
  }

  // ---- alerts (dashboard banner)
  const hasAlerts = await prisma.businessAlert.count({ where: { businessId } });
  if (hasAlerts === 0) {
    await prisma.businessAlert.createMany({
      data: [
        { businessId, type: "pharmacy_urgent_handoff", severity: "critical", message: "Atendimento farmacêutico URGENTE aguardando resposta", actionLabel: "Abrir atendimento", actionHref: "/atendimento", createdAt: ago({ m: 6 }) },
        { businessId, type: "pharmacy_new_order", severity: "info", message: "Novo pedido PED-1015 aguardando confirmação", actionLabel: "Abrir pedidos", actionHref: "/pedidos", createdAt: ago({ m: 3 }) },
        { businessId, type: "pharmacy_rx_uploaded", severity: "info", message: "Nova receita RX-2 para validar", actionLabel: "Abrir receitas", actionHref: "/pedidos?tab=receitas", createdAt: ago({ m: 12 }) },
      ] as never,
    });
  }

  // ---- access log
  if ((await prisma.accessLogEntry.count({ where: { businessId } })) === 0) {
    const log = (who: string, mid: string, action: string, target: string, summary: string, at: Date, category?: string) =>
      prisma.accessLogEntry.create({ data: { businessId, memberId: mid, memberName: who, action, category: category ?? "Outros", target, detail: { summary }, createdAt: at } });
    const E = [
      ["Helena Duarte", memberId.owner, "auth.login", "", "Entrou no painel", ago({ d: 2, h: 3 }), "Acesso"],
      ["Helena Duarte", memberId.owner, "team.invite", "Marcos Silva", "Convidou Marcos Silva (Entregador)", ago({ d: 2, h: 2 }), "Equipe"],
      ["Helena Duarte", memberId.owner, "settings.update", "Entrega", "Atualizou a área de entrega e a taxa", ago({ d: 2, h: 1 }), "Configurações"],
      ["Dra. Carla Menezes", memberId.pharmacist, "catalog.import", "estoque-demo.xlsx", "Importou a planilha de estoque (42 produtos)", ago({ d: 2 }), "Catálogo"],
      ["Dra. Carla Menezes", memberId.pharmacist, "class.confirm", "Analgésicos", "Confirmou a classe de 8 produtos", ago({ d: 2 }), "Catálogo"],
      ["Dra. Carla Menezes", memberId.pharmacist, "prescription.approve", "RX-1", "Aprovou RX-1 do pedido PED-1008", ago({ h: 3 }), "Receita"],
      ["Dra. Carla Menezes", memberId.pharmacist, "prescription.reject", "RX-3", "Rejeitou RX-3 do pedido PED-1014 (Receita ilegível)", ago({ d: 1, h: 7 }), "Receita"],
      ["Dra. Carla Menezes", memberId.pharmacist, "handoff.answer", "Ana Lima", "Respondeu um atendimento farmacêutico", ago({ m: 120 }), "Atendimento"],
      ["Camila Torres", memberId.attendant, "order.cancel", "PED-1005", "Cancelou o pedido PED-1005 (Sem estoque)", ago({ d: 2, h: 5 }), "Pedido"],
      ["Rafael Gomes", memberId.manager, "order.assign_courier", "PED-1008", "Atribuiu PED-1008 a Marcos Silva", ago({ h: 3 }), "Pedido"],
      ["Marcos Silva", memberId.courier, "order.out", "PED-1008", "Marcou PED-1008 como saiu para entrega", ago({ h: 2, m: 40 }), "Pedido"],
    ] as const;
    for (const e of E) await log(e[0], e[1], e[2], e[3], e[4], e[5], e[6]);
  }

  // ---- counters: never move backwards
  const maxOrder = Math.max(...ORDERS.map((o) => o.n));
  const maxRx = Math.max(...Object.values(nextRx));
  await prisma.pharmacySettings.update({
    where: { businessId },
    data: {
      nextOrderNumber: Math.max(settings.nextOrderNumber, maxOrder + 1),
      nextRxNumber: Math.max(settings.nextRxNumber, maxRx + 1),
    },
  });

  console.log(`Seeded "Farmácia Exemplo" (slug ${SLUG}, id ${businessId}). Stock sheet date refreshed to now.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
