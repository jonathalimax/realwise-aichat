import { createHash } from "crypto";
import * as cheerio from "cheerio";

export async function fetchWebsiteText(url: string): Promise<{ markdown: string; contentHash: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": "RealwiseBot/1.0 (+https://realwise.com.br)" },
    signal: AbortSignal.timeout(15000),
  });
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
