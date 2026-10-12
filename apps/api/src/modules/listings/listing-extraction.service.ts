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
  code?: unknown;
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
  code?: string;
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
  // Per-document provenance — the document this item was extracted from, and that document's own
  // authoritative `Fonte: <url>` URL (when present and non-boilerplate). Used to override a
  // hallucinated/misattributed rawItem.url and to populate sourceDocumentId/sourceUrl.
  documentId: string;
  pageUrl?: string;
}

// Same discipline as FlowService's existing extractListings(): never invent a field, omit rather
// than fabricate a placeholder. Extended to ask for structured address/vehicle/property attributes
// and the full set of images associated with each distinct item.
const SYSTEM_PROMPT_TEMPLATE = (businessName: string) =>
  [
    `Você é um extrator de dados para a ${businessName}.`,
    "Extraia anúncios (imóveis ou veículos) genuinamente descritos no texto abaixo.",
    "Responda APENAS com um array JSON (até 10 itens por trecho), cada item podendo conter os campos:",
    '{ "title": string, "code": string, "description": string, "price": string, "url": string, "addressLine": string, "neighborhood": string, "city": string, "state": string, "listingType": string, "transaction": "aluguel"|"venda", "bedrooms": number, "parkingSpots": number, "areaM2": number, "brand": string, "model": string, "year": number, "mileageKm": number, "images": string[] }',
    "Regras: nunca invente um item ou valor de campo que não apareça explicitamente no texto. Se um campo não aparecer no texto para aquele item, OMITA o campo (nunca invente um placeholder).",
    "NUNCA trate texto de carregamento, erro ou estado vazio da página como conteúdo real — se o valor de um campo contiver algo como 'Carregando...', 'Loading...', 'Aguarde', 'Consulte', 'undefined', 'null', 'R$ ???.???.???,00', '--', 'Preço a definir' ou uma sequência de '?' no lugar dos números, OMITA esse campo (e se nem o título for conteúdo real, não inclua o item).",
    "'description' deve ser bem pontuada, fácil de ler e usar apenas informações presentes no texto original — remova quebras de linha excessivas/aleatórias, repetições e qualquer rodapé de contato/telefone/CRECI que não seja parte da descrição do imóvel/veículo em si, mas nunca invente ou reescreva o conteúdo além de normalizar a formatação. Quando o texto original mudar de assunto (ex: de um cômodo/pavimento para outro, de características gerais para uma observação final), separe com uma quebra de linha dupla (\\n\\n) em vez de um texto corrido único — não force tudo em um único parágrafo.",
    "'transaction' só deve ser preenchido se o texto disser explicitamente aluguel ou venda.",
    "'city'/'state' só devem ser preenchidos se citados explicitamente no texto daquele item.",
    // A short literal token (e.g. "AP139") is a much easier copy task for the model than an array
    // of long URLs — this is what makes the deterministic image-by-code matching below possible,
    // since the model's own title/description rarely preserve the raw "Cód: X" boilerplate text.
    "'code' deve ser o código/referência do item copiado EXATAMENTE como aparece no texto após 'Cód:', 'Código:' ou 'Referência:' (ex: se o texto tem 'Cód: AP139', o valor de code é \"AP139\", sem o prefixo 'Cód:'). OMITA o campo se não houver um código explícito no texto para esse item.",
    "'images' deve conter TODAS as URLs de 'Foto: <url>' claramente associadas a esse item específico (não apenas a primeira) — nunca reaproveite uma 'Foto:' distante no texto ou que pareça ser logo/ícone do site.",
    // Smaller instruct models reliably fill simple string/number fields but tend to silently drop
    // the one array-of-URLs field under instruction load unless given a concrete worked example —
    // confirmed pattern: real titles/prices/descriptions extracted correctly while `images` came
    // back empty for every item across an entire real run. A literal example right next to the
    // schema (not just a prose rule) is the fix that actually changes smaller-model behavior here.
    'Exemplo de como preencher "images": se o trecho contém "Apartamento Centro Foto: https://cdn.site.com/a.jpg Foto: https://cdn.site.com/b.jpg", o item correspondente deve incluir "images": ["https://cdn.site.com/a.jpg", "https://cdn.site.com/b.jpg"] — nunca omita esse campo quando existir ao menos uma URL de Foto: genuinamente associada ao item.',
    // Confirmed real-world pattern (Allure listing pages): a single item's photo gallery repeats
    // the SAME title/código/preço block before every "Foto:" line, once per thumbnail — e.g. the
    // same "Cód: AP139 ... R$ 588.000,00" block appears 20+ times, each followed by a different
    // Foto: URL. Without calling this out explicitly, the repetition reads as noise/boilerplate
    // and the model tends to drop the whole images field defensively.
    "Atenção a um padrão comum: quando o MESMO título/código/preço se repete várias vezes no texto, cada repetição seguida de uma 'Foto:' diferente, isso é a galeria de fotos de UM ÚNICO item (não itens duplicados) — colete TODAS essas URLs de Foto: distintas no campo \"images\" desse item, mesmo que sejam 10, 20 ou mais. Não crie itens repetidos para o mesmo anúncio e não descarte o campo \"images\" por causa da repetição.",
    "'url' só deve vir de um link real no formato [texto](url) ou de uma URL http(s) explícita no texto daquele item, copiada caractere por caractere exatamente como aparece no texto — NUNCA construa, monte ou infira uma URL a partir de um código de referência, slug ou padrão observado em outras URLs, e NUNCA use um link de navegação/home do site como se fosse a URL do item.",
    // Confirmed real-world failure mode (Allure's /busca grid page): in a dense list of several
    // items, the model sometimes attached the url of an ADJACENT item to the wrong title/code —
    // e.g. item "APARTAMENTO NOVO PRÓXIMO AO PARQUE BACACHERI" (code AP-xxx) ended up with the
    // url belonging to a completely different apartment a few lines away. This is a worse outcome
    // than simply omitting 'url' — a wrong link sends a visitor to someone else's listing. The
    // instruction above ("copie do texto daquele item") wasn't specific enough to stop cross-item
    // bleed in a tightly packed grid, so this spells out the actual failure mode and the safe
    // default.
    "Em listas densas com vários itens próximos (ex: uma página de grade/busca com vários cards seguidos), SÓ atribua uma URL a um item se ela estiver inequivocamente dentro do bloco de texto DAQUELE item específico (mesmo título/código/preço) — nunca pegue emprestada a URL de um item vizinho só porque está perto no texto, mesmo que pareça plausível. Na dúvida sobre a qual item uma URL pertence, OMITA o campo 'url' para esse item em vez de arriscar atribuí-la ao item errado — enviar um link errado é pior do que não ter link nenhum.",
    "Se nenhum item real e distinto puder ser identificado no trecho, responda com um array vazio [].",
    "IMPORTANTE: use EXATAMENTE os nomes de campos em inglês especificados acima (title, price, addressLine, etc) — nunca traduza as chaves do JSON para português.",
    "O VALOR de 'listingType' deve usar obrigatoriamente um destes termos em português, conforme o tipo de anúncio:",
    "Imóveis: apartamento, casa, casa_condominio, studio, terreno, comercial, rural.",
    "Veículos: hatch, seda, suv, picape, 7lugares, premium, eletrico, moto.",
    "Nunca use termos em inglês (ex: 'house', 'apartment', 'land') nem valores fora dessa lista para 'listingType' — escolha o termo da lista que melhor descreve o item.",
  ].join("\n");

// Filename-based fallback for page-chrome images (logo, banners, etc) — never treat these as a
// real per-listing photo. Mirrors apps/worker/src/website-extract.ts's CHROME_IMAGE_PATTERN.
const CHROME_IMAGE_PATTERN = /(logo|favicon|icon|sprite|avatar|placeholder|banner|\/shared\/|watermark|selo)/i;

// Confirmed real bug from a live run: the image-association pass (and, in principle, the main
// extraction call too) can confuse "URL associated with this item" with the item's own detail-
// page link and return that as an "image" — e.g. ".../imovel/apartamento-xyz-260" with no image
// extension at all, not a real CDN photo URL. An actual photo URL always has an image extension
// (optionally followed by a query string, e.g. Next.js's /_next/image?url=...) or is itself a
// Next.js image-proxy URL — require one or the other.
const IMAGE_LOOKS_LIKE_PHOTO_PATTERN = /\.(jpe?g|png|gif|webp|avif|bmp)(\?|$)|\/_next\/image\?/i;

// Dedicated second pass, scoped to ONLY title+images, for whichever items the main extraction
// call left with an empty images array. Two independent live runs (with increasingly explicit
// prompt instructions added directly to the main schema) both still came back with zero images
// across every item — the 19-field schema's cognitive load, not prompt wording, is the actual
// blocker for this small model. A narrow, single-purpose call removes that load entirely.
const IMAGE_ASSOCIATION_SYSTEM_PROMPT = [
  "Você recebe um trecho de texto de uma página de anúncios e uma lista de títulos de itens já identificados nesse trecho.",
  "Para CADA título da lista, encontre todas as URLs de 'Foto: <url>' que aparecem associadas a esse item específico no trecho (geralmente o título/código/preço do item se repete antes de cada Foto: do mesmo item — colete TODAS essas repetições).",
  "Responda APENAS com um array JSON: [{ \"title\": string, \"images\": string[] }, ...], um objeto por título da lista recebida.",
  "Copie as URLs caractere por caractere exatamente como aparecem no texto — nunca invente, monte ou corrija uma URL.",
  "Nunca inclua uma 'Foto:' que pareça ser logo, ícone ou banner do site, nem uma 'Foto:' claramente associada a outro item.",
  "Se um título não tiver nenhuma Foto: associada no trecho, responda \"images\": [] para ele.",
].join("\n");

// Matches the per-page `Fonte: <url>` annotation appended to each document's extractedMarkdown by
// apps/worker/src/processors/website-sync.ts — this is that document's own authoritative URL.
const SOURCE_URL_PATTERN = /\nFonte:\s*(\S+)$/;

// Matches the JSON-LD block apps/worker/src/processors/website-sync.ts embeds into
// extractedMarkdown (see that file for why this is a marker block rather than a DB column).
const STRUCTURED_DATA_PATTERN = /<!--STRUCTURED_DATA\n([\s\S]*?)\nSTRUCTURED_DATA-->/;

function parseStructuredDataBlock(markdown: string): Record<string, unknown>[] {
  const match = markdown.match(STRUCTURED_DATA_PATTERN);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function flattenStructuredValue(value: unknown): Record<string, unknown> {
  // schema.org sites nest the useful fields at varying depths (offers.price, about.numberOfRooms,
  // address.addressLocality, brand.name, etc) — liberally flatten one level of known wrapper
  // objects into the top level instead of trying to model every exact schema shape.
  if (!value || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...obj };
  for (const wrapperKey of ["offers", "about", "address", "brand", "itemOffered"]) {
    const wrapper = obj[wrapperKey];
    if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) {
      for (const [key, val] of Object.entries(wrapper as Record<string, unknown>)) {
        if (merged[key] === undefined) merged[key] = val;
      }
    }
  }
  return merged;
}

function structuredImages(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value != null ? [value] : [];
  return raw
    .map((img) => (typeof img === "object" && img && "url" in (img as Record<string, unknown>) ? (img as Record<string, unknown>).url : img))
    .map((img) => safeHttpUrl(img))
    .filter((img): img is string => Boolean(img) && !CHROME_IMAGE_PATTERN.test(img as string));
}

function structuredString(value: unknown): string | undefined {
  if (typeof value === "object" && value) return structuredString((value as Record<string, unknown>).name);
  return parseRealStr(value);
}

function structuredNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "object" && value) return structuredNumber((value as Record<string, unknown>).value);
  const parsed = typeof value === "string" ? Number(value.replace(/[^\d.-]/g, "")) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

const STRUCTURED_LISTING_TYPE_BY_SCHEMA_TYPE: Record<string, string> = {
  House: "casa",
  SingleFamilyResidence: "casa",
  Residence: "casa",
  Apartment: "apartamento",
  ApartmentComplex: "apartamento",
  Accommodation: "apartamento",
};

// Maps a single schema.org JSON-LD object (already liberally flattened) directly to
// ExtractedListing — skips the LLM entirely for whatever structured data a site already hands us.
function mapStructuredDataToListing(raw: Record<string, unknown>, documentId: string, pageUrl: string | undefined): ExtractedListing | null {
  const flat = flattenStructuredValue(raw);
  const title = parseRealStr(flat.name ?? flat.title);
  if (!title) return null;

  const priceRaw = flat.price;
  const priceCents = structuredNumber(priceRaw) != null ? Math.round((structuredNumber(priceRaw) as number) * 100) : undefined;
  const priceText = priceCents != null ? String(structuredNumber(priceRaw)) : undefined;

  const schemaType = typeof raw["@type"] === "string" ? (raw["@type"] as string) : Array.isArray(raw["@type"]) ? (raw["@type"] as string[])[0] : undefined;

  let url = safeHttpUrl(flat.url);
  if (url && isBoilerplateUrl(url)) url = undefined;

  return {
    title,
    description: cleanDescription(parseRealStr(flat.description)),
    priceText,
    priceCents,
    url: pageUrl ?? url,
    addressLine: parseRealStr(flat.streetAddress),
    neighborhood: parseRealStr(flat.addressNeighborhood ?? flat.neighborhood),
    city: parseRealStr(flat.addressLocality),
    state: parseRealStr(flat.addressRegion),
    listingType: schemaType ? STRUCTURED_LISTING_TYPE_BY_SCHEMA_TYPE[schemaType] : undefined,
    bedrooms: parseInt2(structuredNumber(flat.numberOfRooms ?? flat.numberOfBedrooms)),
    parkingSpots: undefined,
    areaM2: parseInt2(structuredNumber(flat.floorSize ?? flat.area)),
    brand: schemaType === "Vehicle" || schemaType === "Car" ? structuredString(flat.brand ?? flat.manufacturer) : undefined,
    model: schemaType === "Vehicle" || schemaType === "Car" ? parseRealStr(flat.model) : undefined,
    year: parseInt2(structuredNumber(flat.vehicleModelDate ?? flat.productionDate)),
    mileageKm: parseInt2(structuredNumber(flat.mileageFromOdometer)),
    images: structuredImages(flat.image),
    documentId,
    pageUrl,
  };
}

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

// Fallback for when the model's cleaned-up title/description strips the "Cód: X" boilerplate
// text entirely (it's instructed to), leaving findExplicitReferenceCode() with nothing to match
// even though the item's real code is still visible as the trailing path segment on its own
// detail-page URL (Vista CRM and similar platforms consistently end a listing URL in its code,
// e.g. ".../apartamento-tingui-curitiba-pr-2-quartos-56.98m2-AP139"). Without this, a listing
// whose code wasn't caught in its own text fell back to a content-hash-derived synthetic code —
// which is deterministic per dedupKey but NOT per listing identity, so a different chunk/run that
// DID capture the real code created a second row for the same URL that the image-association
// pass could never match a photo to (it only ever matches on the real code).
function findReferenceCodeFromUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const lastSegment = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (!lastSegment) return undefined;
    const lastToken = lastSegment.split("-").pop();
    if (!lastToken) return undefined;
    // Must look like a real short alphanumeric code with at least one digit — excludes plain
    // descriptive words (e.g. "quartos") and decimal area tokens (e.g. "72.22m2", which contains
    // a "." the pattern below rejects).
    return /^[a-z0-9]{2,12}$/i.test(lastToken) && /\d/.test(lastToken) ? lastToken.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

// Deterministic alternative to asking the LLM to associate photos with items — confirmed via
// direct inspection of real crawled markdown that this doesn't need a model at all. Real listing
// sites (Vista CRM — a template used by many Brazilian real-estate agencies, not just this one
// customer — and similar platforms) repeat the SAME reference code right next to every one of an
// item's photos: the <img> alt text itself (e.g. "Imagem da propriedade AP139 1") and a nearby
// "Cód: AP139" line both carry the item's own code, immediately before/after each "Foto: <url>".
// Scanning the window for codes near each Foto: line and grouping by code is both free (no extra
// LLM call) and more reliable than LLM recall across a long, repetitive block. Only a fallback to
// the LLM-based association pass (kept below) when a business's site doesn't expose explicit
// reference codes at all.
const FOTO_LINE_PATTERN = /Foto:\s*(\S+)/g;
const CODE_PROXIMITY_WINDOW = 300;

function extractImagesByCodeProximity(window: string): Map<string, string[]> {
  const codeToImages = new Map<string, string[]>();
  for (const match of window.matchAll(FOTO_LINE_PATTERN)) {
    const url = match[1];
    const matchIndex = match.index ?? 0;
    const context = window.slice(Math.max(0, matchIndex - CODE_PROXIMITY_WINDOW), matchIndex + CODE_PROXIMITY_WINDOW);
    const code = findExplicitReferenceCode(context);
    if (!code) continue;
    const existing = codeToImages.get(code);
    if (existing) {
      if (!existing.includes(url)) existing.push(url);
    } else {
      codeToImages.set(code, [url]);
    }
  }
  return codeToImages;
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

// A handful of common HTML entities that occasionally slip through a scrape's text extraction
// (parseRealStr only trims/coerces — it never decodes entities).
const HTML_ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

// Trailing "Leia mais"/"Ver mais"/ellipsis truncation markers some source sites append to a
// listing's teaser text before the full description, plus a final line that's clearly footer
// boilerplate (a bare phone number, WhatsApp mention, or "Entre em contato"/CRECI line) rather
// than real listing content. Deliberately conservative — only ever drops a LAST line that fully
// matches one of these shapes, never touches text in the middle of the description.
const TRAILING_READ_MORE_PATTERN = /\s*(?:leia mais|ver mais|veja mais)\.*\s*$/i;
const TRAILING_ELLIPSIS_PATTERN = /\s*\.{3,}\s*$/;
const FOOTER_LINE_PATTERN =
  /^(?:\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}|whats ?app:?.*|entre em contato.*|fale com a gente.*|creci[\s:.-]*\d+.*|contato:.*)$/i;

// Deterministic cleanup applied to every raw description captured from either extraction path
// (structured JSON-LD mapping and LLM window extraction) — collapses scraping whitespace noise
// and strips a short list of known scraping artifacts, without rewriting or restructuring the
// actual listing content.
function cleanDescription(raw?: string): string | undefined {
  if (!raw) return undefined;

  let text = raw;
  for (const [entity, replacement] of Object.entries(HTML_ENTITY_MAP)) {
    text = text.split(entity).join(replacement);
  }

  // Normalize line breaks, trim each line, collapse runs of blank lines into a single blank
  // line (so paragraph breaks survive), and collapse horizontal whitespace within a line.
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  const collapsedLines: string[] = [];
  for (const line of lines) {
    if (line === "" && collapsedLines[collapsedLines.length - 1] === "") continue;
    collapsedLines.push(line);
  }
  while (collapsedLines.length > 0 && collapsedLines[0] === "") collapsedLines.shift();
  while (collapsedLines.length > 0 && collapsedLines[collapsedLines.length - 1] === "") collapsedLines.pop();

  // Drop a trailing footer-boilerplate line (phone/WhatsApp/CRECI/"entre em contato") — but only
  // the very last non-empty line, so real content mentioning a phone mid-description survives.
  while (collapsedLines.length > 0) {
    const lastLine = collapsedLines[collapsedLines.length - 1];
    if (lastLine !== "" && FOOTER_LINE_PATTERN.test(lastLine)) {
      collapsedLines.pop();
      while (collapsedLines.length > 0 && collapsedLines[collapsedLines.length - 1] === "") collapsedLines.pop();
      continue;
    }
    break;
  }

  let cleaned = collapsedLines.join("\n").replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(TRAILING_READ_MORE_PATTERN, "").replace(TRAILING_ELLIPSIS_PATTERN, "");
  cleaned = cleaned.trim();

  return cleaned || undefined;
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

    // Studio was retired in favor of essencial/profissional — listing extraction is core
    // product functionality for the imobiliária/concessionária niches, not a premium add-on,
    // and must run regardless of plan.
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return noop;

    const documents = await this.prisma.client.knowledgeDocument.findMany({
      where: { businessId, status: "processed", extractedMarkdown: { not: null } },
      select: { id: true, extractedMarkdown: true },
    });
    if (documents.length === 0) return noop;

    // Window PER DOCUMENT instead of concatenating every document into one blob first — a
    // property's canonical `Fonte: <url>` only reliably sits at the END of its OWN document, so
    // windowing per-document keeps it co-located with that property's actual data instead of
    // landing in some other property's window after concatenation.
    interface DocWindows {
      documentId: string;
      pageUrl?: string;
      windows: string[];
    }
    const perDocument: DocWindows[] = [];
    const extracted: ExtractedListing[] = [];
    for (const doc of documents) {
      const text = doc.extractedMarkdown ?? "";
      if (!text.trim()) continue;
      const sourceMatch = text.match(SOURCE_URL_PATTERN);
      const candidateUrl = sourceMatch ? safeHttpUrl(sourceMatch[1]) : undefined;
      const pageUrl = candidateUrl && !isBoilerplateUrl(candidateUrl) ? candidateUrl : undefined;

      // Structured data (JSON-LD) a site already emits maps directly to ExtractedListing fields
      // with no LLM call needed — the LLM-windowing path below still runs over the same
      // document's text as a fallback, and the existing dedup logic merges the two if they
      // describe the same item.
      const structuredItems = parseStructuredDataBlock(text)
        .map((item) => mapStructuredDataToListing(item, doc.id, pageUrl))
        .filter((item): item is ExtractedListing => item !== null);
      extracted.push(...structuredItems);

      perDocument.push({ documentId: doc.id, pageUrl, windows: windowText(text, WINDOW_SIZE) });
    }
    if (perDocument.length === 0) return noop;

    // Distribute the MAX_WINDOWS_PER_RUN budget across documents round-robin, so no document is
    // silently dropped entirely — flattening all windows and truncating at the cap would starve
    // documents that happen to sort later.
    type WindowJob = { documentId: string; pageUrl?: string; window: string };
    const windowJobs: WindowJob[] = [];
    const totalAvailableWindows = perDocument.reduce((sum, d) => sum + d.windows.length, 0);
    {
      let round = 0;
      let added = true;
      while (added && windowJobs.length < MAX_WINDOWS_PER_RUN) {
        added = false;
        for (const doc of perDocument) {
          if (windowJobs.length >= MAX_WINDOWS_PER_RUN) break;
          if (round >= doc.windows.length) continue;
          windowJobs.push({ documentId: doc.documentId, pageUrl: doc.pageUrl, window: doc.windows[round] });
          added = true;
        }
        round++;
      }
    }
    if (totalAvailableWindows > MAX_WINDOWS_PER_RUN) {
      this.logger.warn(
        `extractForBusiness ${businessId}: ${totalAvailableWindows} windows found across ${perDocument.length} documents, only processing ${windowJobs.length} (round-robin across documents) — some content skipped`,
      );
    }

    const runStartedAt = new Date();
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE(business.name);
    let failedWindows = 0;

    for (const { documentId, pageUrl, window } of windowJobs) {
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
          // visitor-facing chat requests on the same gateway. 50s keeps a slow run from blocking
          // the gateway for anywhere near as long while still giving the bigger listing_extraction
          // model (see managed.ts's 45s internal timeout for this purpose) room to actually finish
          // instead of the client aborting first.
          timeoutMs: 50000,
        });
        const raw = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        const windowItems: ExtractedListing[] = [];
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
            .filter((img): img is string => Boolean(img))
            .filter((img) => {
              if (CHROME_IMAGE_PATTERN.test(img)) return false;
              // isBoilerplateUrl is for item.url (the listing's own page link, which should
              // never BE an image file) — deliberately NOT applied here: BOILERPLATE_URL_EXT_PATTERN
              // rejects any URL ending in .jpg/.png/etc, which is the exact shape every real photo
              // URL has. Confirmed live via diagnostics: this was silently discarding every valid
              // photo candidate the model ever correctly returned.
              if (!IMAGE_LOOKS_LIKE_PHOTO_PATTERN.test(img)) return false;
              if (!window.includes(img)) {
                this.logger.warn(
                  `extractForBusiness ${businessId}: rejected image URL not verbatim in source window — "${img}"`,
                );
                return false;
              }
              return true;
            });

          // rawItem.url rarely survives a verbatim check unchanged by the model's paraphrasing;
          // validate it first, then let the document's own `pageUrl` win for single-listing
          // detail pages (Issue 3.5) — pageUrl is already validated+non-boilerplate above.
          let candidateRawUrl = safeHttpUrl(rawItem.url);
          if (candidateRawUrl && isBoilerplateUrl(candidateRawUrl)) candidateRawUrl = undefined;
          if (candidateRawUrl && !window.includes(candidateRawUrl)) {
            this.logger.warn(
              `extractForBusiness ${businessId}: rejected item URL not verbatim in source window — "${candidateRawUrl}"`,
            );
            candidateRawUrl = undefined;
          }
          const resolvedUrl = pageUrl ?? candidateRawUrl;

          windowItems.push({
            title: rawItem.title,
            // The model occasionally includes trailing words beyond the literal code (e.g. "243
            // VENDA TERRENO" instead of "243") despite the instruction — take only the leading
            // alphanumeric/hyphen token so it matches the keys extractImagesByCodeProximity builds.
            code: parseStr(rawItem.code)?.toUpperCase().match(/^[A-Z0-9-]+/)?.[0],
            description: cleanDescription(parseRealStr(rawItem.description)),
            priceText,
            priceCents: parsedPrice?.priceCents,
            pricePeriod: parsedPrice?.pricePeriod,
            url: resolvedUrl,
            documentId,
            pageUrl,
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

        // Deterministic pass first (see extractImagesByCodeProximity above) — free, no LLM
        // involved, and more reliable than model recall when the site exposes reference codes.
        const codeToImages = extractImagesByCodeProximity(window);
        if (codeToImages.size > 0) {
          for (const item of windowItems) {
            if (item.images.length > 0) continue;
            // item.code is the model's own copy of the item's literal "Cód: X" token — far more
            // reliable than re-deriving it from title/description, which rarely preserve that raw
            // boilerplate text. Fall back to the old heuristic for windows where the model didn't
            // return a code but title/description happen to contain one anyway.
            const code = item.code ?? findExplicitReferenceCode(`${item.title} ${item.description ?? ""}`);
            const candidateUrls = code ? codeToImages.get(code) : undefined;
            if (!candidateUrls) continue;
            item.images = candidateUrls
              .map((img) => safeHttpUrl(img))
              .filter((img): img is string => Boolean(img))
              .filter((img) => {
                if (CHROME_IMAGE_PATTERN.test(img)) return false;
                // Deliberately no isBoilerplateUrl check here — see the main extraction path's
                // identical comment above for why.
                if (!IMAGE_LOOKS_LIKE_PHOTO_PATTERN.test(img)) return false;
                if (!window.includes(img)) return false;
                return true;
              });
          }
        }

        // Dedicated second pass (see IMAGE_ASSOCIATION_SYSTEM_PROMPT above) for whichever items
        // the deterministic pass above still left with zero images (e.g. the site doesn't expose
        // explicit reference codes) — only worth the extra LLM call when the window actually
        // contains photo annotations to associate.
        const itemsNeedingImages = windowItems.filter((item) => item.images.length === 0);
        if (itemsNeedingImages.length > 0 && window.includes("Foto:")) {
          try {
            const imageResult = await generateFromGateway({
              purpose: "listing_extraction",
              businessId,
              systemPrompt: IMAGE_ASSOCIATION_SYSTEM_PROMPT,
              prompt: `Títulos dos itens já identificados neste trecho:\n${itemsNeedingImages.map((i) => `- ${i.title}`).join("\n")}\n\nTrecho:\n${window}`,
              maxTokens: 3000,
              timeoutMs: 50000,
            });
            const imageRaw = imageResult.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
            const parsedImages = JSON.parse(imageRaw);
            if (Array.isArray(parsedImages)) {
              for (const entry of parsedImages as { title?: unknown; images?: unknown }[]) {
                if (!entry || typeof entry.title !== "string" || !Array.isArray(entry.images)) continue;
                const entryTitle = entry.title;
                const match = itemsNeedingImages.find((item) => normalizeForCompare(item.title) === normalizeForCompare(entryTitle));
                if (!match) continue;
                match.images = (entry.images as unknown[])
                  .map((img) => safeHttpUrl(img))
                  .filter((img): img is string => Boolean(img))
                  .filter((img) => {
                    if (CHROME_IMAGE_PATTERN.test(img)) return false;
                    // Deliberately no isBoilerplateUrl check here — see the main extraction path's
                    // identical comment above for why.
                    if (!IMAGE_LOOKS_LIKE_PHOTO_PATTERN.test(img)) return false;
                    if (!window.includes(img)) {
                      this.logger.warn(
                        `extractForBusiness ${businessId}: rejected image URL not verbatim in source window (image-association pass) — "${img}"`,
                      );
                      return false;
                    }
                    return true;
                  });
              }
            }
          } catch (error) {
            this.logger.warn(
              `extractForBusiness ${businessId}: image-association pass failed — ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        extracted.push(...windowItems);
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
      // Falls back to the code embedded in the item's own detail-page URL when the model's
      // cleaned-up text no longer carries it — see findReferenceCodeFromUrl's comment.
      const explicitCode =
        findExplicitReferenceCode(`${item.title} ${item.description ?? ""}`) ??
        // item.url (the model-extracted "this item's own detail link", used for "Ver anúncio")
        // is populated even for items extracted from a grid/search page's text — item.pageUrl
        // (the page actually crawled) is only set for genuine single-listing detail pages, so it
        // stays blank for exactly the items this fallback most needs to help. Try both: the
        // model's own per-item url first, falling back to the crawled page's url.
        findReferenceCodeFromUrl(item.url) ??
        findReferenceCodeFromUrl(item.pageUrl);
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

      // System provenance fields — deliberately kept OUTSIDE the overriddenFields filter above:
      // they describe where this run's data came from, not owner-editable listing content, so an
      // owner override on e.g. `url` must never also freeze stale provenance.
      const provenanceData = {
        sourceDocumentId: item.documentId,
        sourceUrl: item.pageUrl ?? null,
      };

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
            ...provenanceData,
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
                ...provenanceData,
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
    const failureRate = windowJobs.length > 0 ? failedWindows / windowJobs.length : 0;
    const runCoverageUnreliable = extracted.length === 0 || failureRate > 0.2;
    if (runCoverageUnreliable) {
      const existingActiveCount = await this.prisma.client.listing.count({
        where: { businessId, status: "active" },
      });
      if (existingActiveCount > 0) {
        this.logger.warn(
          `extractForBusiness ${businessId}: unreliable run (${failedWindows}/${windowJobs.length} windows failed, ${extracted.length} items extracted) with ${existingActiveCount} active listing(s) existing — skipping inactive sweep to avoid wiping inventory on a failed run`,
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

    // Cross-document image fallback: some sites render a listing's own detail page client-side
    // (our crawler, which doesn't execute JS, then only ever sees a "Carregando..."/loading
    // shell with no real content), while the SAME reference code and its photos also appear on a
    // server-rendered grid/search page crawled elsewhere on the same site. The per-window
    // association above (extractImagesByCodeProximity) only looks at the window a listing's own
    // text came from, so it misses this case entirely — confirmed live on a real tenant where the
    // detail page was an empty shell but a 14K-char grid page carried the same code next to real
    // "Foto:" lines. This pass gives every still-imageless listing one more chance against every
    // OTHER page crawled for this business before giving up.
    const stillImageless = await this.prisma.client.listing.findMany({
      where: { businessId, status: "active", images: { none: {} } },
      select: { id: true, referenceCode: true },
    });
    if (stillImageless.length > 0) {
      const documents = await this.prisma.client.knowledgeDocument.findMany({
        where: { businessId, source: "website_sync", status: "processed" },
        select: { extractedMarkdown: true },
      });
      for (const listing of stillImageless) {
        if (!listing.referenceCode) continue;
        for (const doc of documents) {
          if (!doc.extractedMarkdown) continue;
          const codeToImages = extractImagesByCodeProximity(doc.extractedMarkdown);
          const images = codeToImages.get(listing.referenceCode);
          if (images && images.length > 0) {
            await this.createImages(listing.id, images);
            break;
          }
        }
      }
    }

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
