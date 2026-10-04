import { createHash } from "crypto";
import { lookup as dnsLookup, LookupAllOptions } from "dns";
import * as cheerio from "cheerio";
import { Agent } from "undici";
import { assertPublicHttpUrl, isBlockedIp } from "./url-safety";
import { fetchRobots } from "./robots";
import { discoverFromSitemaps } from "./sitemap";

const MAX_REDIRECTS = 5;
const MAX_PAGES = 40;
const MAX_DEPTH = 2;
const MAX_PAGE_CHARS = 20000;
const MIN_CRAWL_DELAY_MS = 250;
const MAX_CRAWL_MS = 180_000;
const MAX_TOTAL_CHARS = 600_000;
// Strip all query params except these — e.g. /estoque/?marca=honda and /estoque/?marca=toyota
// are the same page for crawl-budget purposes; keeping pagination params avoids collapsing
// genuinely distinct paginated listing pages into one.
const QUERY_ALLOWLIST = new Set(["page", "pagina"]);
const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|svg|webp|zip|rar|mp4|mp3|avi|mov|docx?|xlsx?|css|js|ico|woff2?|ttf)$/i;
// Filename-based fallback for page-chrome images that aren't inside a semantic <header>/<nav>/
// <footer> (e.g. a logo sitting in a plain <div class="navbar">) — never treat these as a real
// per-listing photo.
const CHROME_IMAGE_PATTERN = /(logo|favicon|icon|sprite|avatar|placeholder|banner|\/shared\/|watermark|selo)/i;

// Validates the resolved address at the moment the socket actually connects, closing the
// TOCTOU window a separate pre-fetch dns.lookup() would leave open to DNS rebinding.
function safeLookup(hostname: string, options: any, callback: any) {
  dnsLookup(hostname, { ...options, all: true } as LookupAllOptions, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    if (list.length === 0 || list.some((a) => isBlockedIp(a.address))) {
      return callback(new Error(`Resolved address for ${hostname} is not a public unicast address`));
    }
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const safeAgent = new Agent({ connect: { lookup: safeLookup, timeout: 15000 } as any });

async function safeFetch(rawUrl: string, redirectsLeft = MAX_REDIRECTS): Promise<Response> {
  const url = await assertPublicHttpUrl(rawUrl);

  const res = await fetch(url, {
    headers: { "user-agent": "RealwiseBot/1.0 (+https://realwise.com.br)" },
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
    // @ts-expect-error — dispatcher is a Node/undici extension accepted by global fetch, not in the DOM lib types
    dispatcher: safeAgent,
  });

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get("location");
    if (!location) throw new Error("Redirect response missing Location header");
    if (redirectsLeft <= 0) throw new Error("Too many redirects");
    const nextUrl = new URL(location, url).toString();
    return safeFetch(nextUrl, redirectsLeft - 1);
  }

  return res;
}

const BLOCK_TAGS = new Set([
  "div", "p", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6",
  "section", "article", "header", "footer", "ul", "ol", "table", "br", "hr", "form", "figure",
]);

// Walks the DOM collecting text with separators between siblings/blocks, since a bare
// .text() call concatenates adjacent elements (e.g. brand logo links) with no whitespace.
// Also surfaces real <a href> and <img src> URLs inline near the text they relate to (as
// `[texto](url)` / `Foto: url` annotations) so listing links/photos genuinely present in the
// source HTML survive into the extracted text instead of being silently stripped — without this,
// the chat/RAG pipeline has no URL to ever show, even when the scraped page has real ones.
function extractTextWithSeparators($: cheerio.CheerioAPI, node: any, base: URL): string {
  let out = "";
  const children = $(node).contents().toArray();
  for (const child of children) {
    if (child.type === "text") {
      out += (child as any).data ?? "";
    } else if (child.type === "tag") {
      const tagName = (child as any).name;
      if (tagName === "img") {
        const alt = $(child).attr("alt");
        const src = $(child).attr("src");
        if (alt) out += ` ${alt} `;
        if (src && !src.startsWith("data:") && !CHROME_IMAGE_PATTERN.test(src)) {
          try {
            const resolved = new URL(src, base).toString();
            out += ` Foto: ${resolved} `;
          } catch {
            // ignore malformed src
          }
        }
        continue;
      }
      const inner = extractTextWithSeparators($, child, base);
      if (tagName === "a") {
        const href = $(child).attr("href");
        if (href && !href.startsWith("#") && !href.startsWith("mailto:") && !href.startsWith("tel:") && !href.startsWith("javascript:")) {
          try {
            const resolved = new URL(href, base);
            resolved.hash = "";
            const label = inner.trim();
            out += label ? ` [${label}](${resolved.toString()}) ` : ` ${resolved.toString()} `;
            continue;
          } catch {
            // fall through to plain inner text below on malformed href
          }
        }
      }
      out += BLOCK_TAGS.has(tagName) ? `\n${inner}\n` : ` ${inner} `;
    }
  }
  return out;
}

// schema.org types commonly used by real-estate/dealer site themes to mark up a single listing —
// kept liberal since site authors vary a lot in which of these they actually emit.
const STRUCTURED_DATA_TYPES = new Set([
  "RealEstateListing",
  "House",
  "Apartment",
  "SingleFamilyResidence",
  "Residence",
  "ApartmentComplex",
  "Accommodation",
  "Vehicle",
  "Car",
  "Product",
  "Offer",
]);

function matchesStructuredType(type: unknown): boolean {
  if (typeof type === "string") return STRUCTURED_DATA_TYPES.has(type);
  if (Array.isArray(type)) return type.some((t) => typeof t === "string" && STRUCTURED_DATA_TYPES.has(t));
  return false;
}

// Collects schema.org JSON-LD objects (and nested @graph entries) that look like a real-estate
// or vehicle listing, so apps/api's extraction service can read structured fields directly
// instead of paying for an LLM call on content the site already hands us pre-structured.
function extractStructuredData($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // malformed JSON-LD on real sites is common — skip this script tag, keep the page
    }
    const candidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const graph = (candidate as Record<string, unknown>)["@graph"];
      const entries = Array.isArray(graph) ? graph : [candidate];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const obj = entry as Record<string, unknown>;
        if (matchesStructuredType(obj["@type"])) found.push(obj);
      }
    }
  });
  return found;
}

function extractPage(html: string, pageUrl: string): { title: string; text: string; links: string[]; structuredData: Record<string, unknown>[] } {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const structuredData = extractStructuredData($);

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    try {
      const resolved = new URL(href, base);
      resolved.hash = "";
      if (resolved.hostname === base.hostname && !SKIP_EXTENSIONS.test(resolved.pathname)) {
        links.push(resolved.toString());
      }
    } catch {
      // ignore malformed hrefs
    }
  });

  // header/nav/footer repeat identically on every crawled page — an <img> in there is page chrome
  // (logo, icons), never a real per-listing photo, and without removing it the structured-listing
  // extraction LLM can mistake "the nearest Foto: annotation" for that listing's actual photo.
  $("script, style, nav, header, footer, noscript, svg").remove();
  const title = $("title").first().text().trim();
  const text = extractTextWithSeparators($, $("body").get(0), base)
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    // Joined as separate paragraphs (not single-newline lines) so chunkMarkdown's blank-line
    // paragraph splitter can actually break this up — a page with no blank lines otherwise
    // becomes one unsplit chunk that can exceed the embedding model's context window.
    .join("\n\n")
    .slice(0, MAX_PAGE_CHARS);

  return { title, text, links: [...new Set(links)], structuredData };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Collapses query-string variants of the same path (e.g. ?marca=honda vs ?marca=toyota) so
// they don't each separately eat into the per-run page budget, while still letting pagination
// params like ?page=2 count as distinct pages.
function normalizeForDedup(rawUrl: string): string {
  const url = new URL(rawUrl);
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (QUERY_ALLOWLIST.has(key)) kept.set(key, value);
  }
  url.search = kept.toString();
  url.hash = "";
  return url.toString();
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  structuredData: Record<string, unknown>[];
}

// Below this, a plain-fetch extraction whose source HTML is much larger is treated as
// "suspiciously empty" — a decent heuristic for a client-side-rendered page where the initial
// HTML is mostly an empty app shell and the real content only appears after JS runs.
const CSR_FALLBACK_MIN_TEXT_CHARS = 2000;
const CSR_FALLBACK_MIN_HTML_RATIO = 10;

// Lazily imported — only paid for (and only requires the Chromium binary to be installed) on
// the rare page that actually trips the CSR heuristic below, not on every crawled page.
async function renderWithPlaywright(url: string): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ userAgent: "RealwiseBot/1.0 (+https://realwise.com.br)" });
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      return await page.content();
    } finally {
      await browser.close();
    }
  } catch {
    return null; // Chromium missing/crashed/timed out — fall back to whatever plain-fetch got
  }
}

export interface FetchWebsiteResult {
  pages: CrawledPage[];
  contentHash: string;
  pagesVisited: number;
}

async function fetchAndExtract(url: string): Promise<{ title: string; text: string; links: string[]; structuredData: Record<string, unknown>[] } | null> {
  let res: Response;
  try {
    res = await safeFetch(url);
  } catch {
    return null; // skip pages that fail SSRF checks or network errors, don't abort the whole crawl
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
  const html = await res.text();
  const extracted = extractPage(html, url);

  // Only pay for a headless render as a fallback — rendering every page is slow and resource
  // heavy, so this only fires when plain-fetch's result looks like an empty CSR app shell.
  const looksSuspiciouslyEmpty =
    extracted.text.length < CSR_FALLBACK_MIN_TEXT_CHARS && html.length > extracted.text.length * CSR_FALLBACK_MIN_HTML_RATIO;
  if (looksSuspiciouslyEmpty) {
    const renderedHtml = await renderWithPlaywright(url);
    if (renderedHtml) {
      const renderedExtracted = extractPage(renderedHtml, url);
      if (renderedExtracted.text.length > extracted.text.length) return renderedExtracted;
    }
  }

  return extracted;
}

export async function fetchWebsiteText(seedUrl: string): Promise<FetchWebsiteResult> {
  const origin = new URL(seedUrl).origin;
  const robots = await fetchRobots(origin);
  const crawlDelayMs = Math.max(robots.crawlDelayMs, MIN_CRAWL_DELAY_MS);
  const deadline = Date.now() + MAX_CRAWL_MS;

  const pages: CrawledPage[] = [];
  let totalChars = 0;
  const visited = new Set<string>();

  const sitemapUrls = await discoverFromSitemaps(origin, robots);

  if (sitemapUrls.length >= 5) {
    for (const url of sitemapUrls) {
      if (visited.size >= MAX_PAGES) break;
      if (Date.now() >= deadline || totalChars >= MAX_TOTAL_CHARS) break;
      const key = normalizeForDedup(url);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!robots.isAllowed(new URL(url).pathname)) continue;

      const extracted = await fetchAndExtract(url);
      if (extracted?.text) {
        pages.push({ url, title: extracted.title, text: extracted.text, structuredData: extracted.structuredData });
        totalChars += extracted.text.length;
      }
      if (visited.size < sitemapUrls.length) await sleep(crawlDelayMs);
    }
  } else {
    const queue: { url: string; depth: number }[] = [{ url: seedUrl, depth: 0 }];

    while (queue.length > 0 && visited.size < MAX_PAGES) {
      if (Date.now() >= deadline || totalChars >= MAX_TOTAL_CHARS) break;
      const { url, depth } = queue.shift()!;
      const key = normalizeForDedup(url);
      if (visited.has(key)) continue;
      visited.add(key);

      if (!robots.isAllowed(new URL(url).pathname)) continue;

      const extracted = await fetchAndExtract(url);
      if (extracted?.text) {
        pages.push({ url, title: extracted.title, text: extracted.text, structuredData: extracted.structuredData });
        totalChars += extracted.text.length;
      }

      if (extracted && depth < MAX_DEPTH) {
        for (const link of extracted.links) {
          const linkKey = normalizeForDedup(link);
          if (!visited.has(linkKey) && queue.length + visited.size < MAX_PAGES) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }

      if (queue.length > 0) await sleep(crawlDelayMs);
    }
  }

  const contentHash = createHash("sha256")
    .update(pages.map((p) => `${p.url}\n${p.text}`).join("\n\n---\n\n"))
    .digest("hex");

  return { pages, contentHash, pagesVisited: visited.size };
}
