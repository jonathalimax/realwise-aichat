import { createHash } from "crypto";
import { lookup as dnsLookup, LookupAllOptions } from "dns";
import * as cheerio from "cheerio";
import { Agent } from "undici";
import { assertPublicHttpUrl, isBlockedIp } from "./url-safety";

const MAX_REDIRECTS = 5;
const MAX_PAGES = 40;
const MAX_DEPTH = 2;
const MAX_PAGE_CHARS = 20000;
const CRAWL_DELAY_MS = 250;
const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|svg|webp|zip|rar|mp4|mp3|avi|mov|docx?|xlsx?|css|js|ico|woff2?|ttf)$/i;

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
        if (src && !src.startsWith("data:")) {
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

function extractPage(html: string, pageUrl: string): { title: string; text: string; links: string[] } {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);

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

  $("script, style, nav, footer, noscript, svg").remove();
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

  return { title, text, links: [...new Set(links)] };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWebsiteText(seedUrl: string): Promise<{ markdown: string; contentHash: string; pagesVisited: number }> {
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: seedUrl, depth: 0 }];
  const sections: string[] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let res: Response;
    try {
      res = await safeFetch(url);
    } catch {
      continue; // skip pages that fail SSRF checks or network errors, don't abort the whole crawl
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) continue;

    const html = await res.text();
    const { title, text, links } = extractPage(html, url);
    if (text) {
      sections.push(`## ${title || url}\n\n${text}\n\nFonte: ${url}`);
    }

    if (depth < MAX_DEPTH) {
      for (const link of links) {
        if (!visited.has(link) && queue.length + visited.size < MAX_PAGES) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }

    if (queue.length > 0) await sleep(CRAWL_DELAY_MS);
  }

  const markdown = sections.join("\n\n---\n\n");
  const contentHash = createHash("sha256").update(markdown).digest("hex");

  return { markdown, contentHash, pagesVisited: visited.size };
}
