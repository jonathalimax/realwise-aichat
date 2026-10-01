import { createHash } from "crypto";
import { lookup as dnsLookup, LookupAllOptions } from "dns";
import * as cheerio from "cheerio";
import { Agent } from "undici";
import { assertPublicHttpUrl, isBlockedIp } from "./url-safety";

const MAX_REDIRECTS = 5;

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

export async function fetchWebsiteText(rawUrl: string): Promise<{ markdown: string; contentHash: string }> {
  const res = await safeFetch(rawUrl);
  if (!res.ok) throw new Error(`Website fetch failed: ${res.status}`);
  const html = await res.text();

  const $ = cheerio.load(html);
  $("script, style, nav, footer, noscript, svg").remove();

  const title = $("title").first().text().trim();
  const bodyText = $("body")
    .text()
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  const markdown = title ? `# ${title}\n\n${bodyText}` : bodyText;
  const contentHash = createHash("sha256").update(markdown).digest("hex");

  return { markdown, contentHash };
}
