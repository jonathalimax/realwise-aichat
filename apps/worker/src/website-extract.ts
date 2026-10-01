import { createHash } from "crypto";
import * as cheerio from "cheerio";
import { assertPublicHttpUrl } from "./url-safety";

const MAX_REDIRECTS = 5;

async function safeFetch(rawUrl: string, redirectsLeft = MAX_REDIRECTS): Promise<Response> {
  const url = await assertPublicHttpUrl(rawUrl);

  const res = await fetch(url, {
    headers: { "user-agent": "RealwiseBot/1.0 (+https://realwise.com.br)" },
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
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
