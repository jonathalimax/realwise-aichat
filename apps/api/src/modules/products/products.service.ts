import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@realwise/db";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import { classLabelPlain, type SaleClass } from "../pharmacy-common/labels";
import { parseLimit, sliceCursor } from "../pharmacy-common/format";
import { deleteFile, getFile, putFile, sniffFileType } from "../pharmacy-common/storage";
import { dedupKeyFor, digitsOnlyEan, productDto, type ProductRow } from "./product-utils";

const CLASSES: SaleClass[] = ["unclassified", "otc", "prescription", "controlled"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function bad(code: string, message: string, extra: Record<string, unknown> = {}) {
  return new BadRequestException({ statusCode: 400, error: "Bad Request", code, message, ...extra });
}

function optStr(v: unknown, key: string, max: number): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") throw bad("INVALID_PRODUCT", `Campo inválido: ${key}.`);
  const t = v.trim();
  if (t.length > max) throw bad("INVALID_PRODUCT", `${key}: no máximo ${max} caracteres.`);
  return t || null;
}
function optInt(v: unknown, key: string, min: number, max: number): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw bad("INVALID_PRODUCT", `${key}: informe um número inteiro entre ${min} e ${max}.`);
  return v;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
  ) {}

  private async memberNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.client.businessMember.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async list(businessId: string, q: Record<string, string | undefined>) {
    const limit = parseLimit(q.limit);
    const search = q.q?.trim();
    const base: Prisma.ProductWhereInput = {
      businessId,
      deletedAt: null,
      ...(q.active === "true" ? { active: true } : q.active === "false" ? { active: false } : {}),
      ...(q.equivalentGroup ? { equivalentGroup: q.equivalentGroup } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { activeIngredient: { contains: search, mode: "insensitive" } },
              ...(search.replace(/\D/g, "") ? [{ ean: { contains: search.replace(/\D/g, "") } }] : []),
              { sku: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const where: Prisma.ProductWhereInput = {
      ...base,
      ...(q.class && CLASSES.includes(q.class as SaleClass) ? { saleClass: q.class as SaleClass } : {}),
      ...(q.stock === "out" ? { stockQty: 0 } : {}),
    };
    const [rows, grouped, outOfStock, all] = await Promise.all([
      this.prisma.client.product.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.client.product.groupBy({ by: ["saleClass"], where: base, _count: { _all: true } }),
      this.prisma.client.product.count({ where: { ...base, stockQty: 0 } }),
      this.prisma.client.product.count({ where: base }),
    ]);
    const counts = { all, unclassified: 0, prescription: 0, controlled: 0, otc: 0, outOfStock };
    for (const g of grouped) counts[g.saleClass] = g._count._all;
    const { items, nextCursor } = sliceCursor(rows, limit);
    const names = await this.memberNames(items.map((p) => p.classConfirmedBy));
    return { items: items.map((p) => productDto(p as ProductRow, p.classConfirmedBy ? names.get(p.classConfirmedBy) : null)), counts, nextCursor };
  }

  private async find(businessId: string, id: string) {
    const p = await this.prisma.client.product.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!p) throw new NotFoundException("Produto não encontrado.");
    return p;
  }

  async get(businessId: string, id: string) {
    const p = await this.find(businessId, id);
    const [names, equivalents] = await Promise.all([
      this.memberNames([p.classConfirmedBy]),
      p.equivalentGroup
        ? this.prisma.client.product.findMany({
            where: { businessId, deletedAt: null, active: true, equivalentGroup: p.equivalentGroup, id: { not: p.id } },
            select: { id: true, name: true, stockQty: true, priceCents: true },
            orderBy: { name: "asc" },
            take: 20,
          })
        : Promise.resolve([]),
    ]);
    return { ...productDto(p as ProductRow, p.classConfirmedBy ? names.get(p.classConfirmedBy) : null), equivalents };
  }

  async create(actor: MemberContext, body: Record<string, unknown>) {
    const name = optStr(body.name, "name", 200);
    if (!name) throw bad("INVALID_PRODUCT", "Informe o nome do produto.");
    const priceCents = optInt(body.priceCents, "priceCents", 1, 100_000_000);
    if (priceCents === null) throw bad("INVALID_PRODUCT", "Informe o preço em centavos.");
    const ean = body.ean === undefined || body.ean === null || body.ean === "" ? null : digitsOnlyEan(String(body.ean));
    if (body.ean && !ean) throw bad("INVALID_PRODUCT", "EAN inválido (8 a 14 dígitos).");
    const presentation = optStr(body.presentation, "presentation", 120);
    const stockQty = optInt(body.stockQty, "stockQty", 0, 10_000_000);
    const dedupKey = dedupKeyFor({ ean, name, presentation });
    try {
      const p = await this.prisma.client.product.create({
        data: {
          businessId: actor.businessId,
          name,
          presentation,
          manufacturer: optStr(body.manufacturer, "manufacturer", 120),
          ean,
          sku: optStr(body.sku, "sku", 60),
          activeIngredient: optStr(body.activeIngredient, "activeIngredient", 160),
          category: optStr(body.category, "category", 80),
          priceCents,
          stockQty,
          stockAsOf: stockQty !== null ? new Date() : null,
          maxQtyPerOrder: optInt(body.maxQtyPerOrder, "maxQtyPerOrder", 1, 999),
          pharmacistRequired: body.pharmacistRequired === true,
          equivalentGroup: optStr(body.equivalentGroup, "equivalentGroup", 60),
          dedupKey,
          // A manually created product is owned by the pharmacy: imports must not overwrite what was typed.
          overriddenFields: {},
        },
      });
      await this.accessLog.record({ businessId: actor.businessId, actor, action: "catalog.product_update", target: name, summary: `Cadastrou o produto ${name}` });
      return productDto(p as ProductRow);
    } catch (err: any) {
      if (err?.code === "P2002") throw new ConflictException({ statusCode: 409, error: "Conflict", code: "PRODUCT_EXISTS", message: "Já existe um produto com este EAN ou nome e apresentação." });
      throw err;
    }
  }

  async update(actor: MemberContext, id: string, body: Record<string, unknown>) {
    if ("saleClass" in body) throw bad("USE_CLASS_ENDPOINT", "A classe é alterada somente por POST /products/:id/class (exige farmacêutico).");
    const p = await this.find(actor.businessId, id);
    const data: Prisma.ProductUpdateInput = {};
    const overridden = { ...((p.overriddenFields ?? {}) as Record<string, boolean>) };
    const changed: string[] = [];
    const mark = (field: string) => {
      overridden[field] = true;
      changed.push(field);
    };
    let name = p.name;
    let presentation = p.presentation;
    let ean = p.ean;
    for (const [key, v] of Object.entries(body)) {
      if (v === undefined) continue;
      switch (key) {
        case "name": {
          const n = optStr(v, key, 200);
          if (!n) throw bad("INVALID_PRODUCT", "O nome não pode ficar vazio.");
          data.name = name = n;
          mark(key);
          break;
        }
        case "presentation":
          data.presentation = presentation = optStr(v, key, 120);
          mark(key);
          break;
        case "manufacturer":
          data.manufacturer = optStr(v, key, 120);
          mark(key);
          break;
        case "ean": {
          const e = v === null || v === "" ? null : digitsOnlyEan(String(v));
          if (v && !e) throw bad("INVALID_PRODUCT", "EAN inválido (8 a 14 dígitos).");
          data.ean = ean = e;
          mark(key);
          break;
        }
        case "sku":
          data.sku = optStr(v, key, 60);
          mark(key);
          break;
        case "activeIngredient":
          data.activeIngredient = optStr(v, key, 160);
          mark(key);
          break;
        case "category":
          data.category = optStr(v, key, 80);
          mark(key);
          break;
        case "priceCents": {
          const n = optInt(v, key, 1, 100_000_000);
          if (n === null) throw bad("INVALID_PRODUCT", "Preço inválido.");
          data.priceCents = n;
          mark(key);
          break;
        }
        case "stockQty": {
          data.stockQty = optInt(v, key, 0, 10_000_000);
          // A manual stock edit is "as of now" for that row only.
          data.stockAsOf = new Date();
          mark(key);
          break;
        }
        case "pharmacistRequired":
          if (typeof v !== "boolean") throw bad("INVALID_PRODUCT", "pharmacistRequired deve ser verdadeiro ou falso.");
          data.pharmacistRequired = v;
          mark(key);
          break;
        case "maxQtyPerOrder":
          data.maxQtyPerOrder = optInt(v, key, 1, 999);
          mark(key);
          break;
        case "equivalentGroup":
          data.equivalentGroup = optStr(v, key, 60);
          mark(key);
          break;
        case "active":
          if (typeof v !== "boolean") throw bad("INVALID_PRODUCT", "active deve ser verdadeiro ou falso.");
          data.active = v;
          mark(key);
          break;
        default:
          break;
      }
    }
    if (changed.length === 0) return this.get(actor.businessId, id);
    if (changed.some((c) => ["name", "presentation", "ean"].includes(c))) data.dedupKey = dedupKeyFor({ ean, name, presentation });
    data.overriddenFields = overridden;
    try {
      await this.prisma.client.product.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === "P2002") throw new ConflictException({ statusCode: 409, error: "Conflict", code: "PRODUCT_EXISTS", message: "Já existe um produto com este EAN ou nome e apresentação." });
      throw err;
    }
    await this.accessLog.record({
      businessId: actor.businessId,
      actor,
      action: "catalog.product_update",
      target: name,
      summary: `Atualizou ${name}`,
      detail: { fields: changed },
    });
    return this.get(actor.businessId, id);
  }

  /** Confirm (or manually set) the sale class. Pharmacist only (controller enforces classes:edit + CRF). */
  async setClass(actor: MemberContext, id: string, saleClass: unknown) {
    if (typeof saleClass !== "string" || !CLASSES.includes(saleClass as SaleClass)) throw bad("INVALID_CLASS", "Classe inválida.");
    const cls = saleClass as SaleClass;
    const p = await this.find(actor.businessId, id);
    const now = new Date();
    await this.prisma.client.product.update({
      where: { id },
      data:
        cls === "unclassified"
          ? { saleClass: "unclassified", classConfirmedAt: null, classConfirmedBy: null }
          : {
              saleClass: cls,
              classConfirmedAt: now,
              classConfirmedBy: actor.memberId,
              // The pharmacist's decision becomes the current proposal too, so it no longer shows as "needs review".
              classProposed: cls,
              classProposedBy: p.classProposed === cls ? p.classProposedBy : "manual",
              classProposedReason: p.classProposed === cls ? p.classProposedReason : `confirmado por ${actor.name}`,
            },
    });
    await this.accessLog.record({
      businessId: actor.businessId,
      actor,
      action: "class.confirm",
      target: p.name,
      summary: `Classificou ${p.name} como ${classLabelPlain(cls)}`,
      detail: { productId: id, saleClass: cls },
    });
    return this.get(actor.businessId, id);
  }

  // ------------------------------------------------------------------ images

  async setImage(actor: MemberContext, id: string, file: { buffer: Buffer } | undefined) {
    const p = await this.find(actor.businessId, id);
    if (!file?.buffer?.length) throw bad("FILE_REQUIRED", "Envie uma imagem.");
    if (file.buffer.length > MAX_IMAGE_BYTES) throw bad("FILE_TOO_LARGE", "A imagem deve ter até 2 MB.");
    const type = sniffFileType(file.buffer);
    if (!type || !type.mime.startsWith("image/")) throw bad("INVALID_IMAGE", "Use uma imagem JPEG, PNG ou WebP.");
    const key = `products/${actor.businessId}/${randomUUID()}.${type.ext}`;
    await putFile(key, file.buffer);
    const updated = await this.prisma.client.product.update({ where: { id }, data: { imageKey: key } });
    if (p.imageKey) await deleteFile(p.imageKey);
    await this.accessLog.record({ businessId: actor.businessId, actor, action: "catalog.product_update", target: p.name, summary: `Atualizou a imagem de ${p.name}`, detail: { fields: ["image"] } });
    return { imageUrl: `/api/public/products/${id}/image?v=${updated.updatedAt.getTime()}` };
  }

  async removeImage(actor: MemberContext, id: string) {
    const p = await this.find(actor.businessId, id);
    if (p.imageKey) {
      await this.prisma.client.product.update({ where: { id }, data: { imageKey: null } });
      await deleteFile(p.imageKey);
      await this.accessLog.record({ businessId: actor.businessId, actor, action: "catalog.product_update", target: p.name, summary: `Removeu a imagem de ${p.name}`, detail: { fields: ["image"] } });
    }
    return { ok: true as const };
  }

  /** Public bytes of a product image: only active products of live businesses. */
  async publicImage(id: string): Promise<{ data: Buffer; mime: string }> {
    const p = await this.prisma.client.product.findFirst({
      where: { id, active: true, deletedAt: null, imageKey: { not: null }, business: { status: "live" } },
      select: { imageKey: true },
    });
    if (!p?.imageKey) throw new NotFoundException();
    try {
      const data = await getFile(p.imageKey);
      const type = sniffFileType(data);
      if (!type) throw new NotFoundException();
      return { data, mime: type.mime };
    } catch {
      throw new NotFoundException();
    }
  }
}
