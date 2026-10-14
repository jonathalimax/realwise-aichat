import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { AccessLogService } from "../access/access-log.service";
import type { MemberContext } from "../access/member-context";
import { getFile, putFile } from "../pharmacy-common/storage";
import type { SaleClass } from "../pharmacy-common/labels";
import { CATALOG_MODEL, type CatalogModelPort } from "./catalog-model";
import {
  IMPORT_FIELDS,
  detectHeaderRow,
  heuristicMapping,
  normalizeRow,
  type ImportField,
  type MappedColumn,
  type RowResult,
} from "./column-mapping";
import { classProposalPatch, planImport, type ExistingProductLite, type ImportPlan } from "./import-plan";
import { SheetParseError, parseSheet, sheetKindFor, type ParsedSheet } from "./sheet-parser";
import { dedupKeyFor } from "../products/product-utils";

export const CATALOG_IMPORT_JOBS = Symbol("CATALOG_IMPORT_JOBS");
export interface CatalogImportJobs {
  enqueue(kind: "map" | "apply", businessId: string, importId: string): Promise<void>;
}

/** Imports up to this many data rows are applied inside the HTTP request; bigger ones go to the worker. */
export const SYNC_APPLY_MAX_ROWS = 3000;
const SAMPLE_ROWS = 20;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MODEL_CLASS_CAP = 200;
const STALE_APPLY_MS = 30 * 60 * 1000;

const GROUP_HINTS: Record<SaleClass, { label: string; hint: string }> = {
  controlled: { label: "Controlados", hint: "Revise um a um. Esses produtos nunca podem ser comprados online." },
  prescription: { label: "Com receita", hint: "Exigem receita. O pedido sempre passa pelo farmacêutico." },
  otc: { label: "Venda livre", hint: "Confirme em lote depois de conferir alguns exemplos." },
  unclassified: { label: "Incertos", hint: "Ficam sem classe e não podem ser vendidos no chat até você decidir." },
};

interface StoredDryRun {
  rows: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
  rejected: number;
  classSummary: Record<SaleClass, number>;
  samples: Record<SaleClass, Array<{ name: string; by: string }>>;
}
interface StoredMapping {
  sheetName?: string;
  headerRow?: number;
  rowCount?: number;
  headers?: string[];
  columns?: MappedColumn[];
  unmapped?: string[];
  modelUsed?: boolean;
  previewRows?: Array<Record<string, string>>;
  dryRun?: StoredDryRun;
  applyParams?: { stockAsOf: string; startedAt: string; memberId: string; memberName: string; pickedUpAt?: string };
  /** Set when a worker (or the inline fallback) starts the map job: tells the fallback not to double-run it. */
  mapPickedUpAt?: string;
}

function err(status: 400 | 409, code: string, message: string, extra: Record<string, unknown> = {}) {
  const body = { statusCode: status, error: status === 400 ? "Bad Request" : "Conflict", code, message, ...extra };
  return status === 400 ? new BadRequestException(body) : new ConflictException(body);
}

/** Unique, non-empty header labels (blank titles become "Coluna 3"; repeated ones get a suffix). */
export function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() || `Coluna ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "planilha";
}

@Injectable()
export class CatalogImportService {
  private readonly logger = new Logger(CatalogImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLog: AccessLogService,
    @Inject(CATALOG_MODEL) private readonly model: CatalogModelPort,
    @Inject(CATALOG_IMPORT_JOBS) private readonly jobs: CatalogImportJobs,
  ) {}

  // ------------------------------------------------------------------ upload

  async upload(actor: MemberContext, file: { originalname: string; mimetype: string; buffer: Buffer } | undefined) {
    if (!file?.buffer?.length) throw err(400, "FILE_REQUIRED", "Envie uma planilha .xlsx ou .csv.");
    if (file.buffer.length > MAX_FILE_BYTES) throw err(400, "FILE_TOO_LARGE", "A planilha deve ter até 20 MB.");
    const kind = sheetKindFor(file.originalname, file.mimetype);
    if (kind === "xls") throw err(400, "UNSUPPORTED_FORMAT", 'Arquivos .xls (Excel antigo) não são suportados. Abra no Excel e use "Salvar como" .xlsx ou .csv.');
    if (!kind) throw err(400, "UNSUPPORTED_FORMAT", "Formato não suportado. Envie um arquivo .xlsx ou .csv.");
    if (kind === "xlsx" && !(file.buffer[0] === 0x50 && file.buffer[1] === 0x4b)) throw err(400, "CORRUPT_FILE", "O arquivo não parece ser uma planilha .xlsx válida.");
    if (kind === "csv" && file.buffer.subarray(0, 4096).includes(0)) throw err(400, "CORRUPT_FILE", "O arquivo não parece ser um CSV válido.");

    // Same private local storage as knowledge documents, but NOT chunked or embedded.
    const storageKey = `catalog/${actor.businessId}/${randomUUID()}-${safeFilename(file.originalname)}`;
    await putFile(storageKey, file.buffer);
    const doc = await this.prisma.client.knowledgeDocument.create({
      data: { businessId: actor.businessId, filename: file.originalname, mimeType: file.mimetype, sizeBytes: file.buffer.length, storageKey, source: "catalog_import", status: "processed" },
    });
    const imp = await this.prisma.client.catalogImport.create({
      data: { businessId: actor.businessId, documentId: doc.id, filename: file.originalname, status: "uploaded", createdByMemberId: actor.memberId },
    });
    await this.dispatch("map", actor.businessId, imp.id);
    return this.get(actor.businessId, imp.id);
  }

  /** Queue the job; when the queue is unreachable (no Redis / no worker) run it in-process so imports never hang. */
  private async dispatch(kind: "map" | "apply", businessId: string, importId: string) {
    const run = () => (kind === "map" ? this.runMap(businessId, importId) : this.runApply(businessId, importId)).catch((e) => this.logger.error(`inline ${kind} failed: ${e instanceof Error ? e.message : e}`));
    if (process.env.CATALOG_IMPORT_INLINE === "true") {
      setImmediate(run);
      return;
    }
    try {
      await Promise.race([this.jobs.enqueue(kind, businessId, importId), new Promise((_, rej) => setTimeout(() => rej(new Error("queue timeout")), 3000))]);
    } catch (e) {
      this.logger.warn(`catalog-import queue unavailable (${e instanceof Error ? e.message : e}); running ${kind} inline`);
      setImmediate(run);
    }
  }

  // ------------------------------------------------------------------ reading

  private async load(businessId: string, id: string) {
    const imp = await this.prisma.client.catalogImport.findFirst({ where: { id, businessId }, include: { document: { select: { storageKey: true, mimeType: true } } } });
    if (!imp) throw new NotFoundException("Importação não encontrada.");
    return imp;
  }

  private async readSheet(imp: { filename: string; document: { storageKey: string; mimeType: string } }): Promise<ParsedSheet> {
    const buf = await getFile(imp.document.storageKey);
    return parseSheet(buf, imp.filename, imp.document.mimeType);
  }

  private async names(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.client.businessMember.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private dto(
    imp: {
      id: string;
      filename: string;
      status: string;
      error: string | null;
      createdAt: Date;
      appliedAt: Date | null;
      stockAsOf: Date | null;
      columnMapping: unknown;
      stats: unknown;
      createdByMemberId: string | null;
    },
    createdByName: string | null,
  ) {
    const m = (imp.columnMapping ?? {}) as StoredMapping;
    const hasMapping = !!m.columns;
    return {
      id: imp.id,
      filename: imp.filename,
      status: imp.status,
      error: imp.error,
      createdAt: imp.createdAt.toISOString(),
      appliedAt: imp.appliedAt ? imp.appliedAt.toISOString() : null,
      stockAsOf: imp.stockAsOf ? imp.stockAsOf.toISOString() : null,
      sheetName: m.sheetName ?? null,
      headerRow: m.headerRow ?? null,
      rowCount: m.rowCount ?? null,
      mapping: hasMapping
        ? {
            columns: (m.columns ?? []).map((c) => ({ sourceColumn: c.sourceColumn, index: c.index, example: c.example, field: c.field, confidence: c.confidence, confidenceScore: c.confidenceScore })),
            unmapped: m.unmapped ?? [],
            modelUsed: m.modelUsed ?? false,
          }
        : null,
      // jsonb does not keep key order: rebuild each preview row in the sheet's column order.
      previewRows: (m.previewRows ?? []).map((r) => (m.headers ? Object.fromEntries(m.headers.map((h) => [h, r[h] ?? ""])) : r)),
      dryRun: m.dryRun
        ? { rows: m.dryRun.rows, toCreate: m.dryRun.toCreate, toUpdate: m.dryRun.toUpdate, skipped: m.dryRun.skipped, rejected: m.dryRun.rejected, classSummary: m.dryRun.classSummary }
        : null,
      stats: imp.status === "applied" ? imp.stats : null,
      createdByName,
    };
  }

  private readonly healing = new Set<string>();

  /**
   * No worker consuming the queue (local dev, worker down)? A job that sits untouched for
   * CATALOG_IMPORT_FALLBACK_SECONDS (default 8, 0 = off) and no worker has marked it as started is run in-process instead. Both jobs are idempotent.
   */
  private maybeSelfHeal(imp: { id: string; businessId: string; status: string; createdAt: Date; columnMapping: unknown }) {
    const afterMs = Number(process.env.CATALOG_IMPORT_FALLBACK_SECONDS ?? 8) * 1000;
    if (!(afterMs > 0) || this.healing.has(imp.id)) return;
    const stored = (imp.columnMapping ?? {}) as StoredMapping;
    const stale = (iso: string | undefined) => !iso || Date.now() - new Date(iso).getTime() > STALE_APPLY_MS;
    let kind: "map" | "apply" | null = null;
    if (imp.status === "uploaded" && Date.now() - imp.createdAt.getTime() > afterMs && stale(stored.mapPickedUpAt)) kind = "map";
    else if (imp.status === "reviewing" && stored.applyParams && Date.now() - new Date(stored.applyParams.startedAt).getTime() > afterMs && stale(stored.applyParams.pickedUpAt)) kind = "apply";
    if (!kind) return;
    this.healing.add(imp.id);
    this.logger.warn(`catalog import ${imp.id} (${kind}) not picked up by the worker in time; running inline`);
    const task = kind === "map" ? this.runMap(imp.businessId, imp.id) : this.runApply(imp.businessId, imp.id);
    void task.catch(() => {}).finally(() => this.healing.delete(imp.id));
  }

  async get(businessId: string, id: string) {
    const imp = await this.load(businessId, id);
    this.maybeSelfHeal(imp);
    const names = await this.names([imp.createdByMemberId]);
    return this.dto(imp, imp.createdByMemberId ? names.get(imp.createdByMemberId) ?? null : null);
  }

  async list(businessId: string, limit = 20) {
    const rows = await this.prisma.client.catalogImport.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100) });
    const names = await this.names(rows.map((r) => r.createdByMemberId));
    return {
      items: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null,
        stockAsOf: r.stockAsOf ? r.stockAsOf.toISOString() : null,
        stats: r.status === "applied" ? r.stats : null,
        createdByName: r.createdByMemberId ? names.get(r.createdByMemberId) ?? null : null,
      })),
    };
  }

  // ------------------------------------------------------------------ job: map

  private dataRows(sheet: ParsedSheet, headerRow: number): Array<{ cells: string[]; rowNumber: number }> {
    return sheet.rows.slice(headerRow).map((cells, i) => ({ cells, rowNumber: headerRow + i + 1 })).filter((r) => r.cells.some((c) => c.trim()));
  }

  private previewOf(headers: string[], rows: Array<{ cells: string[] }>) {
    return rows.slice(0, 5).map((r) => Object.fromEntries(headers.map((h, i) => [h, r.cells[i] ?? ""])));
  }

  /** Worker job `catalog-import:map`. Safe to run twice. */
  async runMap(businessId: string, importId: string): Promise<void> {
    const imp = await this.load(businessId, importId);
    if (imp.status === "applied") return;
    await this.prisma.client.catalogImport.update({ where: { id: importId }, data: { columnMapping: { ...((imp.columnMapping ?? {}) as StoredMapping), mapPickedUpAt: new Date().toISOString() } as object } });
    try {
      const sheet = await this.readSheet(imp);
      const headerIdx = detectHeaderRow(sheet.rows);
      const headers = uniqueHeaders(sheet.rows[headerIdx].map((c) => c));
      const data = this.dataRows(sheet, headerIdx + 1);
      if (data.length === 0) throw new SheetParseError("A planilha não tem linhas de produtos abaixo do cabeçalho.", "EMPTY_SHEET");
      const sample = data.slice(0, SAMPLE_ROWS).map((r) => headers.map((_, i) => r.cells[i] ?? ""));
      const fromModel = await this.model.mapColumns(businessId, headers, sample);
      const columns = fromModel ?? heuristicMapping(headers, sample);
      const mapping: StoredMapping = {
        sheetName: sheet.sheetName,
        headerRow: headerIdx + 1,
        rowCount: data.length,
        headers,
        columns,
        unmapped: columns.filter((c) => c.field === "ignore").map((c) => c.sourceColumn),
        modelUsed: !!fromModel,
        previewRows: this.previewOf(headers, data),
      };
      await this.prisma.client.catalogImport.update({ where: { id: importId }, data: { status: "mapped", columnMapping: mapping as object, error: null } });
    } catch (e) {
      const message = e instanceof SheetParseError ? e.message : "Não foi possível ler a planilha.";
      if (!(e instanceof SheetParseError)) this.logger.error(`catalog import ${importId} map failed: ${e instanceof Error ? e.message : e}`);
      await this.prisma.client.catalogImport.update({ where: { id: importId }, data: { status: "failed", error: message } });
    }
  }

  // ------------------------------------------------------------------ step 2: confirm mapping

  async confirmMapping(actor: MemberContext, id: string, body: { headerRow?: number; columns?: Array<{ sourceColumn: string; field: string }> }) {
    const imp = await this.load(actor.businessId, id);
    if (imp.status !== "mapped" && imp.status !== "reviewing") throw err(409, "INVALID_STATE", "Esta importação não está pronta para mapeamento.");
    const stored = (imp.columnMapping ?? {}) as StoredMapping;
    if (!Array.isArray(body?.columns) || body.columns.length === 0) throw err(400, "INVALID_MAPPING", "Informe o mapeamento das colunas.");
    for (const c of body.columns) {
      if (!(IMPORT_FIELDS as readonly string[]).includes(c?.field)) throw err(400, "INVALID_FIELD", `Campo desconhecido: ${String(c?.field)}`);
    }
    const sheet = await this.readSheet(imp);
    let headerIdx = (stored.headerRow ?? 1) - 1;
    if (body.headerRow !== undefined) {
      if (!Number.isInteger(body.headerRow) || body.headerRow < 1 || body.headerRow > Math.min(sheet.rows.length, 50)) throw err(400, "INVALID_HEADER_ROW", "Linha de cabeçalho inválida.");
      headerIdx = body.headerRow - 1;
    }
    const headers = uniqueHeaders(sheet.rows[headerIdx].map((c) => c));
    const requested = new Map(body.columns.map((c) => [c.sourceColumn, c.field as ImportField]));
    const previousByName = new Map((stored.columns ?? []).map((c) => [c.sourceColumn, c]));
    const taken = new Set<ImportField>();
    const columns: MappedColumn[] = headers.map((h, index) => {
      const field = requested.get(h) ?? "ignore";
      if (field !== "ignore") {
        if (taken.has(field)) throw err(400, "DUPLICATE_FIELD", `Mais de uma coluna foi mapeada como "${field}".`);
        taken.add(field);
      }
      const prev = previousByName.get(h);
      const unchanged = prev?.field === field;
      return {
        sourceColumn: h,
        index,
        example: "",
        field,
        // A column the owner changed is, by definition, certain; one he kept keeps the model's confidence.
        confidence: field === "ignore" ? "low" : unchanged ? prev!.confidence : "high",
        confidenceScore: field === "ignore" ? 0 : unchanged ? prev!.confidenceScore : 1,
      };
    });
    if (!taken.has("name") || !taken.has("price")) {
      throw err(409, "MAPPING_INCOMPLETE", "O mapeamento precisa ter pelo menos as colunas de nome e de preço.", { missing: ["name", "price"].filter((f) => !taken.has(f as ImportField)) });
    }
    const data = this.dataRows(sheet, headerIdx + 1);
    for (const c of columns) c.example = data.map((r) => r.cells[c.index] ?? "").find((s) => s.trim()) ?? "";

    const plan = await this.makePlan(actor.businessId, columns, data);
    const mapping: StoredMapping = {
      ...stored,
      headerRow: headerIdx + 1,
      rowCount: data.length,
      headers,
      columns,
      unmapped: columns.filter((c) => c.field === "ignore").map((c) => c.sourceColumn),
      previewRows: this.previewOf(headers, data),
      dryRun: this.dryRunOf(plan),
    };
    await this.prisma.client.catalogImport.update({ where: { id }, data: { status: "reviewing", columnMapping: mapping as object, error: null } });
    return this.get(actor.businessId, id);
  }

  private rowsToResults(columns: MappedColumn[], data: Array<{ cells: string[]; rowNumber: number }>): RowResult[] {
    const cols = columns.map((c) => ({ index: c.index, field: c.field, sourceColumn: c.sourceColumn }));
    return data.map((r) => normalizeRow(r.cells, cols, r.rowNumber));
  }

  private async existingCatalog(businessId: string): Promise<ExistingProductLite[]> {
    const rows = await this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true, presentation: true, ean: true, dedupKey: true, saleClass: true, classConfirmedAt: true, classProposed: true, overriddenFields: true },
    });
    return rows.map((r) => ({ ...r, overriddenFields: (r.overriddenFields ?? {}) as Record<string, boolean> }));
  }

  private async makePlan(businessId: string, columns: MappedColumn[], data: Array<{ cells: string[]; rowNumber: number }>, modelProposals?: Map<string, any>): Promise<ImportPlan> {
    const existing = await this.existingCatalog(businessId);
    return planImport(this.rowsToResults(columns, data), existing, modelProposals);
  }

  private dryRunOf(plan: ImportPlan): StoredDryRun {
    return { rows: plan.rows, toCreate: plan.creates.length, toUpdate: plan.updates.length, skipped: plan.skipped, rejected: plan.rejected, classSummary: plan.classSummary, samples: plan.samples };
  }

  // ------------------------------------------------------------------ step 3 (informational)

  async classProposals(businessId: string, id: string) {
    const imp = await this.load(businessId, id);
    const dry = ((imp.columnMapping ?? {}) as StoredMapping).dryRun;
    if (!dry) throw err(409, "INVALID_STATE", "Confirme o mapeamento primeiro.");
    const order: SaleClass[] = ["controlled", "prescription", "otc", "unclassified"];
    return {
      groups: order.map((key) => ({ key, label: GROUP_HINTS[key].label, count: dry.classSummary[key] ?? 0, hint: GROUP_HINTS[key].hint, samples: dry.samples?.[key] ?? [] })),
    };
  }

  // ------------------------------------------------------------------ step 4: apply

  /** Returns { dto, accepted }: accepted=true means the worker will finish (HTTP 202). */
  async apply(actor: MemberContext, id: string, body: { stockAsOf?: string; stockUpToDateConfirmed?: boolean }) {
    if (body?.stockUpToDateConfirmed !== true) throw err(400, "STOCK_CONFIRMATION_REQUIRED", "Confirme que a planilha de estoque está atualizada.");
    const asOf = body.stockAsOf ? new Date(body.stockAsOf) : null;
    if (!asOf || isNaN(asOf.getTime())) throw err(400, "INVALID_STOCK_AS_OF", "Informe a data e hora a que o estoque se refere.");
    if (asOf.getTime() > Date.now() + 5 * 60 * 1000) throw err(400, "INVALID_STOCK_AS_OF", "A data do estoque não pode estar no futuro.");
    if (asOf.getTime() < Date.now() - 400 * 24 * 3600 * 1000) throw err(400, "INVALID_STOCK_AS_OF", "A data do estoque é antiga demais.");

    const imp = await this.load(actor.businessId, id);
    const stored = (imp.columnMapping ?? {}) as StoredMapping;
    if (imp.status === "applied") return { dto: await this.get(actor.businessId, id), accepted: false };
    if (imp.status !== "reviewing" || !stored.columns) throw err(409, "INVALID_STATE", "Confirme o mapeamento antes de aplicar.");
    const cols = stored.columns;
    if (!cols.some((c) => c.field === "name") || !cols.some((c) => c.field === "price")) throw err(409, "MAPPING_INCOMPLETE", "O mapeamento precisa ter pelo menos as colunas de nome e de preço.");
    if (stored.applyParams && Date.now() - new Date(stored.applyParams.startedAt).getTime() < STALE_APPLY_MS) {
      return { dto: await this.get(actor.businessId, id), accepted: true }; // already running
    }
    const params = { stockAsOf: asOf.toISOString(), startedAt: new Date().toISOString(), memberId: actor.memberId, memberName: actor.name };
    await this.prisma.client.catalogImport.update({ where: { id }, data: { columnMapping: { ...stored, applyParams: params } as object } });

    if ((stored.rowCount ?? 0) <= SYNC_APPLY_MAX_ROWS) {
      await this.runApply(actor.businessId, id);
      return { dto: await this.get(actor.businessId, id), accepted: false };
    }
    await this.dispatch("apply", actor.businessId, id);
    return { dto: await this.get(actor.businessId, id), accepted: true };
  }

  /** Deterministic apply (sync for small files, worker job `catalog-import:apply` for big ones). */
  async runApply(businessId: string, importId: string): Promise<void> {
    const imp = await this.load(businessId, importId);
    if (imp.status === "applied") return;
    const stored = (imp.columnMapping ?? {}) as StoredMapping;
    const params = stored.applyParams;
    if (!params || !stored.columns) return;
    await this.prisma.client.catalogImport.update({ where: { id: importId }, data: { columnMapping: { ...stored, applyParams: { ...params, pickedUpAt: new Date().toISOString() } } as object } });
    try {
      const sheet = await this.readSheet(imp);
      const data = this.dataRows(sheet, (stored.headerRow ?? 1));
      const results = this.rowsToResults(stored.columns, data);
      const existing = await this.existingCatalog(businessId);

      // Pass 1: sheet column + reference list. Pass 2 adds the model (last resort, capped, never required).
      let plan = planImport(results, existing);
      const needModel = [
        ...plan.creates.filter((c) => !c.proposal).map((c) => ({ key: c.dedupKey, name: c.row.name, activeIngredient: c.row.activeIngredient })),
        ...plan.updates.filter((u) => !u.proposal && !u.existing.classConfirmedAt).map((u) => ({ key: dedupKeyFor(u.row), name: u.row.name, activeIngredient: u.row.activeIngredient })),
      ].slice(0, MODEL_CLASS_CAP);
      if (needModel.length) {
        const guesses = await this.model.proposeClasses(businessId, needModel);
        if (guesses.size) {
          const asProposals = new Map<string, { class: SaleClass; by: "ai"; reason: string }>();
          for (const [k, g] of guesses) if (g.class !== "unclassified") asProposals.set(k, { class: g.class, by: "ai", reason: g.confidence === "high" ? "IA" : "IA, baixa confiança" });
          plan = planImport(results, existing, asProposals);
        }
      }

      const stockAsOf = new Date(params.stockAsOf);
      let created = 0;
      for (let i = 0; i < plan.creates.length; i += 500) {
        const chunk = plan.creates.slice(i, i + 500);
        const res = await this.prisma.client.product.createMany({
          skipDuplicates: true,
          data: chunk.map((c) => ({
            businessId,
            name: c.row.name,
            presentation: c.row.presentation,
            manufacturer: c.row.manufacturer,
            ean: c.row.ean,
            sku: c.row.sku,
            activeIngredient: c.row.activeIngredient,
            category: c.row.category,
            priceCents: c.row.priceCents,
            stockQty: c.row.stockQty,
            stockAsOf,
            equivalentGroup: c.row.equivalentGroup,
            dedupKey: c.dedupKey,
            sourceImportId: importId,
            ...classProposalPatch(null, c.proposal),
          })),
        });
        created += res.count;
      }
      let updated = 0;
      let collided = 0;
      for (let i = 0; i < plan.updates.length; i += 25) {
        const chunk = plan.updates.slice(i, i + 25);
        const outcomes = await Promise.all(
          chunk.map(async (u) => {
            try {
              await this.prisma.client.product.update({
                where: { id: u.existing.id },
                data: {
                  ...(u.patch as object),
                  ...(u.newDedupKey ? { dedupKey: u.newDedupKey } : {}),
                  stockAsOf,
                  sourceImportId: importId,
                  ...classProposalPatch(u.existing, u.proposal),
                },
              });
              return true;
            } catch (e: any) {
              if (e?.code === "P2002") return false;
              throw e;
            }
          }),
        );
        for (const ok of outcomes) ok ? updated++ : collided++;
      }
      const stats = {
        rows: plan.rows,
        created,
        updated,
        skipped: plan.skipped + collided + (plan.creates.length - created),
        unclassified: plan.classSummary.unclassified,
        rejected: plan.rejected,
      };
      await this.prisma.client.catalogImport.update({
        where: { id: importId },
        data: { status: "applied", stats, stockAsOf, appliedAt: new Date(), error: null, columnMapping: { ...stored, applyParams: undefined } as object },
      });
      await this.prisma.client.businessAlert.updateMany({ where: { businessId, type: "pharmacy_stale_sheet", dismissedAt: null }, data: { dismissedAt: new Date() } });
      await this.accessLog.record({
        businessId,
        actor: { memberId: params.memberId, name: params.memberName },
        action: "catalog.import",
        target: imp.filename,
        summary: `Importou ${imp.filename}`,
        detail: { created, updated },
      });
    } catch (e) {
      this.logger.error(`catalog import ${importId} apply failed: ${e instanceof Error ? e.message : e}`);
      await this.prisma.client.catalogImport.update({
        where: { id: importId },
        data: { status: "failed", error: e instanceof SheetParseError ? e.message : "Não foi possível aplicar a importação. Tente novamente.", columnMapping: { ...stored, applyParams: undefined } as object },
      });
    }
  }
}

