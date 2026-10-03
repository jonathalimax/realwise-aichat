import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import type { ListingStatus } from "@realwise/db";
import { PrismaService } from "../../prisma/prisma.service";
import { generateFromGateway } from "../../inference/gateway-client";
import { safeHttpUrl } from "../../common/safe-http-url";
import { parseBrazilianPrice } from "./parse-brazilian-price";

const WINDOW_SIZE = 6000;
const WINDOW_OVERLAP = 600;
const MAX_WINDOWS_PER_RUN = 60;

interface RawExtractedItem {
  title?: unknown;
  description?: unknown;
  price?: unknown;
  url?: unknown;
  addressLine?: unknown;
  neighborhood?: unknown;
  city?: unknown;
  state?: unknown;
  listingType?: unknown;
  transaction?: unknown;
  bedrooms?: unknown;
  parkingSpots?: unknown;
  areaM2?: unknown;
  brand?: unknown;
  model?: unknown;
  year?: unknown;
  mileageKm?: unknown;
  images?: unknown;
}

interface ExtractedListing {
  title: string;
  description?: string;
  priceText?: string;
  priceCents?: number;
  pricePeriod?: string;
  url?: string;
  addressLine?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  listingType?: string;
  transaction?: string;
  bedrooms?: number;
  parkingSpots?: number;
  areaM2?: number;
  brand?: string;
  model?: string;
  year?: number;
  mileageKm?: number;
  images: string[];
}

// Same discipline as FlowService's existing extractListings(): never invent a field, omit rather
// than fabricate a placeholder. Extended to ask for structured address/vehicle/property attributes
// and the full set of images associated with each distinct item.
const SYSTEM_PROMPT_TEMPLATE = (businessName: string) =>
  [
    `Você é um extrator de dados para a ${businessName}.`,
    "Extraia anúncios (imóveis ou veículos) genuinamente descritos no texto abaixo.",
    "Responda APENAS com um array JSON (até 10 itens por trecho), cada item podendo conter os campos:",
    '{ "title": string, "description": string, "price": string, "url": string, "addressLine": string, "neighborhood": string, "city": string, "state": string, "listingType": string, "transaction": "aluguel"|"venda", "bedrooms": number, "parkingSpots": number, "areaM2": number, "brand": string, "model": string, "year": number, "mileageKm": number, "images": string[] }',
    "Regras: nunca invente um item ou valor de campo que não apareça explicitamente no texto. Se um campo não aparecer no texto para aquele item, OMITA o campo (nunca invente um placeholder).",
    "NUNCA trate texto de carregamento, erro ou estado vazio da página como conteúdo real — se o valor de um campo contiver algo como 'Carregando...', 'Loading...', 'Aguarde', 'Consulte', 'undefined', 'null', 'R$ ???.???.???,00', '--', 'Preço a definir' ou uma sequência de '?' no lugar dos números, OMITA esse campo (e se nem o título for conteúdo real, não inclua o item).",
    "'transaction' só deve ser preenchido se o texto disser explicitamente aluguel ou venda.",
    "'city'/'state' só devem ser preenchidos se citados explicitamente no texto daquele item.",
    "'images' deve conter TODAS as URLs de 'Foto: <url>' claramente associadas a esse item específico (não apenas a primeira) — nunca reaproveite uma 'Foto:' distante no texto ou que pareça ser logo/ícone do site.",
    "'url' só deve vir de um link real no formato [texto](url) ou de uma URL http(s) explícita no texto daquele item.",
    "Se nenhum item real e distinto puder ser identificado no trecho, responda com um array vazio [].",
    "IMPORTANTE: use EXATAMENTE os nomes de campos em inglês especificados acima (title, price, addressLine, etc) — nunca traduza as chaves do JSON para português.",
    "O VALOR de 'listingType' deve usar obrigatoriamente um destes termos em português, conforme o tipo de anúncio:",
    "Imóveis: apartamento, casa, casa_condominio, studio, terreno, comercial, rural.",
    "Veículos: hatch, seda, suv, picape, 7lugares, premium, eletrico, moto.",
    "Nunca use termos em inglês (ex: 'house', 'apartment', 'land') nem valores fora dessa lista para 'listingType' — escolha o termo da lista que melhor descreve o item.",
  ].join("\n");

function windowText(text: string, size: number): string[] {
  const windows: string[] = [];
  const step = size - WINDOW_OVERLAP;
  for (let i = 0; ; i += step) {
    windows.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return windows;
}

function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrlForDedup(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return rawUrl.toLowerCase();
  }
}

const BOILERPLATE_URL_PATH_PATTERN =
  /^\/(?:anuncie|contato|sobre|politica[-_a-z]*|termos[-_a-z]*|privacidade|blog|_next\/|wp-content\/|assets\/|static\/)/i;
const BOILERPLATE_URL_EXT_PATTERN = /\.(?:png|jpe?g|webp|svg|gif|css|js)$/i;

function isBoilerplateUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") return true;
    if (BOILERPLATE_URL_PATH_PATTERN.test(pathname)) return true;
    if (BOILERPLATE_URL_EXT_PATTERN.test(pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const FUZZY_TITLE_THRESHOLD = 0.6;
const FUZZY_TITLE_THRESHOLD_STRICT = 0.7;
const FUZZY_PRICE_TOLERANCE = 0.05;
const MATCH_SCORE_TIE_EPSILON = 0.02;

function priceWithinTolerance(a?: number, b?: number): boolean {
  if (a == null || b == null) return true;
  if (a === 0 && b === 0) return true;
  const diff = Math.abs(a - b);
  const base = Math.max(a, b);
  return base === 0 ? true : diff / base <= FUZZY_PRICE_TOLERANCE;
}

function normalizeForCompare(text?: string | null): string {
  return text ? normalizeTitle(text) : "";
}

function hasCorroboratingSignal(
  item: ExtractedListing,
  candidate: { priceCents: number | null; addressLine: string | null; neighborhood: string | null; listingType: string | null },
): boolean {
  if (item.priceCents != null && candidate.priceCents != null && priceWithinTolerance(item.priceCents, candidate.priceCents) && item.priceCents === candidate.priceCents) {
    return true;
  }
  if (normalizeForCompare(item.neighborhood) && normalizeForCompare(item.neighborhood) === normalizeForCompare(candidate.neighborhood)) {
    return true;
  }
  if (normalizeForCompare(item.addressLine) && normalizeForCompare(item.addressLine) === normalizeForCompare(candidate.addressLine)) {
    return true;
  }
  if (normalizeForCompare(item.listingType) && normalizeForCompare(item.listingType) === normalizeForCompare(candidate.listingType)) {
    return true;
  }
  return false;
}

function scoreMatch(
  item: ExtractedListing,
  candidate: { title: string; priceCents: number | null; addressLine: string | null; neighborhood: string | null; listingType: string | null },
): number {
  let score = jaccardSimilarity(normalizeTitle(item.title), normalizeTitle(candidate.title));
  // Exact price match is a strong corroborating signal; a null price on either side contributes
  // zero bonus (never a positive bonus for an absence of data).
  if (item.priceCents != null && candidate.priceCents != null && item.priceCents === candidate.priceCents) {
    score += 0.15;
  }
  if (normalizeForCompare(item.neighborhood) && normalizeForCompare(item.neighborhood) === normalizeForCompare(candidate.neighborhood)) {
    score += 0.1;
  }
  if (normalizeForCompare(item.addressLine) && normalizeForCompare(item.addressLine) === normalizeForCompare(candidate.addressLine)) {
    score += 0.1;
  }
  if (normalizeForCompare(item.listingType) && normalizeForCompare(item.listingType) === normalizeForCompare(candidate.listingType)) {
    score += 0.05;
  }
  return score;
}

function computeDedupKey(item: ExtractedListing, explicitCode?: string): string {
  if (explicitCode) {
    return `code:${explicitCode}`;
  }
  if (item.url && !isBoilerplateUrl(item.url)) {
    return `url:${normalizeUrlForDedup(item.url)}`;
  }
  const basis = `${normalizeTitle(item.title)}|${item.priceCents ?? item.priceText ?? ""}`;
  const hash = createHash("sha256").update(basis).digest("hex");
  return `tp:${hash}`;
}

const EXPLICIT_CODE_PATTERN = /\b(?:ref(?:er[eê]ncia)?|c[oó]d(?:igo)?)\.?:?\s*([a-z0-9-]{2,12})\b/i;

function findExplicitReferenceCode(sourceText: string): string | undefined {
  const match = sourceText.match(EXPLICIT_CODE_PATTERN);
  return match ? match[1].toUpperCase() : undefined;
}

function generateReferenceCode(dedupKey: string): string {
  const hash = createHash("sha256").update(dedupKey).digest("hex").slice(0, 6).toUpperCase();
  return `AP-${hash}`;
}

function parseInt2(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function parseStr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const PLACEHOLDER_VALUE_PATTERN = /carregando|loading|aguarde|undefined|null|\?{3,}/i;

function parseRealStr(value: unknown): string | undefined {
  const str = parseStr(value);
  if (!str) return undefined;
  return PLACEHOLDER_VALUE_PATTERN.test(str) ? undefined : str;
}

function parseTransaction(value: unknown): string | undefined {
  const str = parseStr(value)?.toLowerCase();
  return str === "aluguel" || str === "venda" ? str : undefined;
}

@Injectable()
export class ListingExtractionService {
  private readonly logger = new Logger(ListingExtractionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async extractForBusiness(businessId: string): Promise<{ created: number; updated: number; retired: number }> {
    const noop = { created: 0, updated: 0, retired: 0 };

    // Studio-plan-only gate — same restriction pattern as the existing website-sync-schedule
    // queue in apps/worker/src/index.ts.
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, subscription: { plan: { code: "studio" } } },
    });
    if (!business) return noop;

    const documents = await this.prisma.client.knowledgeDocument.findMany({
      where: { businessId, status: "processed", extractedMarkdown: { not: null } },
      select: { id: true, extractedMarkdown: true },
    });
    const combinedText = documents.map((d) => d.extractedMarkdown ?? "").join("\n\n");
    if (!combinedText.trim()) return noop;

    const windows = windowText(combinedText, WINDOW_SIZE);
    const windowsToProcess = windows.slice(0, MAX_WINDOWS_PER_RUN);
    if (windows.length > MAX_WINDOWS_PER_RUN) {
      this.logger.warn(
        `extractForBusiness ${businessId}: ${windows.length} windows found, only processing first ${MAX_WINDOWS_PER_RUN} — some content skipped`,
      );
    }

    const runStartedAt = new Date();
    const extracted: ExtractedListing[] = [];
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE(business.name);
    let failedWindows = 0;

    for (const window of windowsToProcess) {
      try {
        const result = await generateFromGateway({
          // Split from chat-path "extraction" so admin cost monitoring can isolate background
          // scraper spend from live visitor-chat extraction calls.
          purpose: "listing_extraction",
          businessId,
          systemPrompt,
          prompt: `Gere o array JSON de anúncios a partir do trecho abaixo.\n\nTrecho:\n${window}`,
          // A 6000-char window can contain several listings with descriptions/images — 1500 was
          // tight enough to truncate mid-JSON on a real, non-trivial fraction of windows, which
          // threw in JSON.parse below and silently dropped that window's listings for the run.
          // That run-to-run coverage variance (not the dedupKey issue) was the deeper cause of
          // extraction row counts never fully stabilizing across repeated runs.
          maxTokens: 4000,
          // Capped lower than the chat-path extraction timeouts on purpose: with up to
          // MAX_WINDOWS_PER_RUN windows processed serially, a 60s-per-window timeout let a single
          // extraction run monopolize the inference gateway for up to 60 minutes, starving
          // visitor-facing chat requests on the same gateway. 30s keeps a slow run from blocking
          // the gateway for anywhere near as long while still giving each window a real chance.
          timeoutMs: 30000,
        });
        const raw = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        for (const rawItem of parsed as RawExtractedItem[]) {
          if (
            !rawItem ||
            typeof rawItem !== "object" ||
            typeof rawItem.title !== "string" ||
            PLACEHOLDER_VALUE_PATTERN.test(rawItem.title)
          ) {
            continue;
          }
          const priceText = parseRealStr(rawItem.price);
          const parsedPrice = priceText ? parseBrazilianPrice(priceText) : null;
          const rawImages = Array.isArray(rawItem.images) ? rawItem.images : [];
          const images = rawImages
            .map((img) => safeHttpUrl(img))
            .filter((img): img is string => Boolean(img));

          extracted.push({
            title: rawItem.title,
            description: parseRealStr(rawItem.description),
            priceText,
            priceCents: parsedPrice?.priceCents,
            pricePeriod: parsedPrice?.pricePeriod,
            url: safeHttpUrl(rawItem.url),
            addressLine: parseRealStr(rawItem.addressLine),
            neighborhood: parseRealStr(rawItem.neighborhood),
            city: parseRealStr(rawItem.city),
            state: parseRealStr(rawItem.state),
            listingType: parseStr(rawItem.listingType),
            transaction: parseTransaction(rawItem.transaction),
            bedrooms: parseInt2(rawItem.bedrooms),
            parkingSpots: parseInt2(rawItem.parkingSpots),
            areaM2: parseInt2(rawItem.areaM2),
            brand: parseStr(rawItem.brand),
            model: parseStr(rawItem.model),
            year: parseInt2(rawItem.year),
            mileageKm: parseInt2(rawItem.mileageKm),
            images,
          });
        }
      } catch (error) {
        failedWindows++;
        this.logger.warn(`extractForBusiness ${businessId}: window extraction failed — ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let created = 0;
    let updated = 0;

    // Fetch this business's existing (non-manually-created) listings ONCE, including inactive
    // rows — a listing dropped from a prior run's window slice and re-seen now must be eligible
    // for reactivation via fuzzy match, not just exact-key match. Keep this as an in-memory
    // array and push created/updated rows into it as the loop progresses, so later items in this
    // same run (including intra-run duplicates produced by the new overlapping windows) resolve
    // against earlier items' results instead of creating fresh dupes.
    const candidates: Array<{
      id: string;
      title: string;
      priceCents: number | null;
      addressLine: string | null;
      neighborhood: string | null;
      listingType: string | null;
      status: ListingStatus;
      overriddenFields: unknown;
      dedupKey: string;
    }> = await this.prisma.client.listing.findMany({
      where: { businessId, manuallyCreated: false },
      select: {
        id: true,
        title: true,
        priceCents: true,
        addressLine: true,
        neighborhood: true,
        listingType: true,
        status: true,
        overriddenFields: true,
        dedupKey: true,
      },
    });

    for (const item of extracted) {
      // Only trust an explicit code found within THIS item's own extracted text (title/
      // description) — searching the whole combined document would match the same code for
      // every item. Resolve it BEFORE computing the dedupKey so a stable code can feed in.
      const explicitCode = findExplicitReferenceCode(`${item.title} ${item.description ?? ""}`);
      const dedupKey = computeDedupKey(item, explicitCode);

      let existing = candidates.find((candidate) => candidate.dedupKey === dedupKey) ?? null;
      let dedupKeyNeedsHealing = false;

      // The LLM paraphrases/changes listing URLs between extraction runs, which breaks the
      // url-based dedupKey and otherwise produces a duplicate row for the same real property on
      // every re-run. Fall back to a fuzzy title+price match against this business's own
      // persisted rows (including inactive ones — reactivation happens below) before concluding
      // this is a genuinely new listing.
      if (!existing) {
        const normalizedItemTitle = normalizeTitle(item.title);
        const matches = candidates.filter((candidate) => {
          const similarity = jaccardSimilarity(normalizedItemTitle, normalizeTitle(candidate.title));
          // Bare title-only matches (no corroborating address/neighborhood/price signal) need a
          // higher bar than matches with at least one corroborating signal.
          const threshold = hasCorroboratingSignal(item, candidate) ? FUZZY_TITLE_THRESHOLD : FUZZY_TITLE_THRESHOLD_STRICT;
          if (similarity < threshold) return false;
          return priceWithinTolerance(item.priceCents ?? undefined, candidate.priceCents ?? undefined);
        });
        if (matches.length === 1) {
          existing = matches[0];
          dedupKeyNeedsHealing = true;
        } else if (matches.length > 1) {
          const scored = matches
            .map((candidate) => ({ candidate, score: scoreMatch(item, candidate) }))
            .sort((a, b) => b.score - a.score);
          const [top, second] = scored;
          if (second && top.score - second.score < MATCH_SCORE_TIE_EPSILON) {
            this.logger.warn(
              `extractForBusiness ${businessId}: fuzzy title match for "${item.title}" was ambiguous (top score ${top.score.toFixed(2)} vs ${second.score.toFixed(2)} across ${matches.length} candidates) — falling back to exact dedupKey behavior`,
            );
          } else {
            existing = top.candidate;
            dedupKeyNeedsHealing = true;
          }
        }
      }

      const overridden: Record<string, unknown> = (existing?.overriddenFields as Record<string, unknown>) ?? {};

      const fullData = {
        title: item.title,
        description: item.description,
        priceText: item.priceText,
        priceCents: item.priceCents,
        pricePeriod: item.pricePeriod,
        addressLine: item.addressLine,
        neighborhood: item.neighborhood,
        city: item.city,
        state: item.state,
        listingType: item.listingType,
        transaction: item.transaction,
        bedrooms: item.bedrooms,
        parkingSpots: item.parkingSpots,
        areaM2: item.areaM2,
        brand: item.brand,
        model: item.model,
        year: item.year,
        mileageKm: item.mileageKm,
        url: item.url,
      };

      // Owner corrections must survive re-extraction — skip updating any field listed in the
      // existing row's overriddenFields.
      const dataToWrite: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fullData)) {
        if (overridden[key]) continue;
        dataToWrite[key] = value;
      }

      if (existing) {
        // Self-heal the dedupKey when matched via fuzzy title/price instead of an exact key hit,
        // so a future run with this same (new) URL phrasing hits the primary key match directly
        // rather than requiring fuzzy matching forever. A user who overrode `url` shouldn't block
        // a `code:`-derived heal, which carries different identity semantics than a URL — only
        // gate `url:`/`tp:` heals on the url override.
        const canHealDedupKey = dedupKeyNeedsHealing && (dedupKey.startsWith("code:") || !overridden.url);
        const nextDedupKey = canHealDedupKey ? dedupKey : existing.dedupKey;
        const updatedListing = await this.prisma.client.listing.update({
          where: { id: existing.id },
          data: {
            ...dataToWrite,
            ...(canHealDedupKey ? { dedupKey } : {}),
            lastSeenInSourceAt: runStartedAt,
            status: existing.status === "inactive" ? "active" : existing.status,
          },
        });
        const nextStatus = updatedListing.status;
        if (!overridden.images) {
          await this.prisma.client.listingImage.deleteMany({ where: { listingId: existing.id } });
          await this.createImages(existing.id, item.images);
        }
        const candidateIndex = candidates.findIndex((candidate) => candidate.id === existing!.id);
        if (candidateIndex !== -1) {
          candidates[candidateIndex] = {
            ...candidates[candidateIndex],
            title: overridden.title ? candidates[candidateIndex].title : item.title,
            priceCents: overridden.priceCents ? candidates[candidateIndex].priceCents : item.priceCents ?? null,
            addressLine: overridden.addressLine ? candidates[candidateIndex].addressLine : item.addressLine ?? null,
            neighborhood: overridden.neighborhood ? candidates[candidateIndex].neighborhood : item.neighborhood ?? null,
            listingType: overridden.listingType ? candidates[candidateIndex].listingType : item.listingType ?? null,
            status: nextStatus,
            dedupKey: nextDedupKey,
          };
        }
        updated++;
      } else {
        // Fall back to the deterministic code if the "explicit" one found in this item's own
        // text collides with another listing already created in this same run (e.g. two distinct
        // items both just saying "Cód: 1" ambiguously) — never let a reference-code collision
        // abort the whole run.
        const explicitCodeTaken = explicitCode
          ? await this.prisma.client.listing.findUnique({ where: { businessId_referenceCode: { businessId, referenceCode: explicitCode } } })
          : null;
        let referenceCode = explicitCode && !explicitCodeTaken ? explicitCode : generateReferenceCode(dedupKey);
        // The comment above promises a collision never aborts the run, but the deterministic
        // fallback code can ALSO collide (e.g. two distinct items hashing close enough, or the
        // same item reprocessed via an ambiguous-fuzzy-match fallback landing here twice in one
        // run) — the unique constraint on (businessId, referenceCode) then throws and previously
        // crashed the whole extraction with no per-item isolation. Retry with a salted code a
        // few times before giving up on this one item (never on the whole run).
        let createdListing;
        for (let attempt = 0; ; attempt++) {
          try {
            createdListing = await this.prisma.client.listing.create({
              data: {
                businessId,
                referenceCode,
                dedupKey,
                extractedAt: runStartedAt,
                lastSeenInSourceAt: runStartedAt,
                ...fullData,
                title: item.title,
              },
            });
            break;
          } catch (err) {
            const isUniqueViolation = (err as { code?: string })?.code === "P2002";
            if (!isUniqueViolation || attempt >= 4) {
              this.logger.warn(
                `extractForBusiness ${businessId}: giving up creating "${item.title}" after ${attempt + 1} referenceCode collision(s)`,
              );
              createdListing = null;
              break;
            }
            referenceCode = `${generateReferenceCode(dedupKey)}${randomUUID().slice(0, 4).toUpperCase()}`;
          }
        }
        if (!createdListing) continue;
        await this.createImages(createdListing.id, item.images);
        candidates.push({
          id: createdListing.id,
          title: createdListing.title,
          priceCents: createdListing.priceCents,
          addressLine: createdListing.addressLine,
          neighborhood: createdListing.neighborhood,
          listingType: createdListing.listingType,
          status: createdListing.status,
          overriddenFields: createdListing.overriddenFields,
          dedupKey: createdListing.dedupKey,
        });
        created++;
      }
    }

    // SAFETY GUARD: skip the "anything not re-seen this run is gone" sweep whenever this run's
    // own coverage was too unreliable to trust as a negative signal — either it extracted nothing
    // at all, or a large share of its windows errored out (e.g. the inference gateway was
    // saturated/timing out, as happened live: 2 of ~30+ windows succeeded, which still "extracted"
    // a couple of items and so slipped past a zero-extracted-only guard, retiring 27 real listings
    // down to 2). A partial-failure run must never be trusted to prove absence.
    let retired = 0;
    const failureRate = windowsToProcess.length > 0 ? failedWindows / windowsToProcess.length : 0;
    const runCoverageUnreliable = extracted.length === 0 || failureRate > 0.2;
    if (runCoverageUnreliable) {
      const existingActiveCount = await this.prisma.client.listing.count({
        where: { businessId, status: "active" },
      });
      if (existingActiveCount > 0) {
        this.logger.warn(
          `extractForBusiness ${businessId}: unreliable run (${failedWindows}/${windowsToProcess.length} windows failed, ${extracted.length} items extracted) with ${existingActiveCount} active listing(s) existing — skipping inactive sweep to avoid wiping inventory on a failed run`,
        );
        return { created, updated, retired: 0 };
      }
    }

    const sweepResult = await this.prisma.client.listing.updateMany({
      where: {
        businessId,
        manuallyCreated: false,
        status: "active",
        lastSeenInSourceAt: { lt: runStartedAt },
      },
      data: { status: "inactive" },
    });
    retired = sweepResult.count;

    return { created, updated, retired };
  }

  private async createImages(listingId: string, images: string[]): Promise<void> {
    if (images.length === 0) return;
    await this.prisma.client.listingImage.createMany({
      data: images.map((url, ordinal) => ({ listingId, url, ordinal })),
      skipDuplicates: true,
    });
  }
}
