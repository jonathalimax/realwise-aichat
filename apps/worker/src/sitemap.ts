import * as cheerio from "cheerio";
import { assertPublicHttpUrl } from "./url-safety";
import type { RobotsRules } from "./robots";

const MAX_CHILD_SITEMAPS = 5;
const MIN_NON_HOMEPAGE_URLS = 5;

// Detail-page-shaped paths rank first so the crawl prioritizes real listing pages over
// generic marketing/category pages when a sitemap mixes both — calibrated against real
// Allure listing URLs like /imovel/apartamento-bacacheri-curitiba-pr-2-quartos-72.22m2-263.
const DETAIL_PATH_PATTERN = /\/(imovel|imoveis|veiculo|veiculos|carro|estoque|anuncio|produto|property|listing)\//i;
const TRAILING_CODE_PATTERN = /[a-z0-9]-?\d+\/?$/i;

async function fetchText(url: string): Promise<string | null> {
  try {
    const safeUrl = await assertPublicHttpUrl(url);
    const res = await fetch(safeUrl, {
      headers: { "user-agent": "RealwiseBot/1.0 (+https://realwise.com.br)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractLocs(xml: string): string[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const locs: string[] = [];
  $("loc").each((_, el) => {
    const text = $(el).text().trim();
    if (text) locs.push(text);
  });
  return locs;
}

function rank(url: string, homepage: string): number {
  if (url === homepage) return -1;
  let score = 0;
  if (DETAIL_PATH_PATTERN.test(url)) score += 2;
  if (TRAILING_CODE_PATTERN.test(url)) score += 1;
  return score;
}

export async function discoverFromSitemaps(origin: string, robots: RobotsRules): Promise<string[]> {
  const homepage = new URL("/", origin).toString();
  const host = new URL(origin).hostname;

  let sitemapUrls = robots.sitemaps.length > 0 ? robots.sitemaps : [new URL("/sitemap.xml", origin).toString()];

  const collected = new Set<string>();

  for (const sitemapUrl of sitemapUrls.slice(0, MAX_CHILD_SITEMAPS)) {
    const xml = await fetchText(sitemapUrl);
    if (!xml) continue;

    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    if (isIndex) {
      const childSitemaps = extractLocs(xml).slice(0, MAX_CHILD_SITEMAPS);
      for (const childUrl of childSitemaps) {
        const childXml = await fetchText(childUrl);
        if (!childXml) continue;
        for (const loc of extractLocs(childXml)) collected.add(loc);
      }
    } else {
      for (const loc of extractLocs(xml)) collected.add(loc);
    }
  }

  const filtered = [...collected].filter((url) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== host) return false;
      if (!robots.isAllowed(parsed.pathname)) return false;
      return true;
    } catch {
      return false;
    }
  });

  const nonHomepage = filtered.filter((url) => url !== homepage);
  if (nonHomepage.length < MIN_NON_HOMEPAGE_URLS) return [];

  const ranked = [...filtered].sort((a, b) => rank(b, homepage) - rank(a, homepage));
  return ranked;
}
