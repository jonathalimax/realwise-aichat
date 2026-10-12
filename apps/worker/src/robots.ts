import { assertPublicHttpUrl } from "./url-safety";

export interface RobotsRules {
  isAllowed(path: string): boolean;
  crawlDelayMs: number;
  sitemaps: string[];
}

interface RuleGroup {
  userAgents: string[];
  rules: { prefix: string; allow: boolean }[];
  crawlDelayMs: number;
}

const OUR_USER_AGENT = "RealwiseBot";

function parseRobotsTxt(body: string): RobotsRules {
  const lines = body.split(/\r?\n/);
  const groups: RuleGroup[] = [];
  const sitemaps: string[] = [];
  let current: RuleGroup | null = null;
  let sawRuleSinceAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (current && sawRuleSinceAgent) {
        // A new "User-agent:" line after rules were already seen starts a brand-new group.
        current = null;
      }
      if (!current) {
        current = { userAgents: [], rules: [], crawlDelayMs: 0 };
        groups.push(current);
        sawRuleSinceAgent = false;
      }
      current.userAgents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (key === "disallow") {
      sawRuleSinceAgent = true;
      if (value !== "") current.rules.push({ prefix: value, allow: false });
      continue;
    }
    if (key === "allow") {
      sawRuleSinceAgent = true;
      if (value !== "") current.rules.push({ prefix: value, allow: true });
      continue;
    }
    if (key === "crawl-delay") {
      sawRuleSinceAgent = true;
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds)) current.crawlDelayMs = Math.max(0, seconds * 1000);
      continue;
    }
  }

  function groupFor(agentLower: string): RuleGroup | undefined {
    return groups.find((g) => g.userAgents.includes(agentLower));
  }

  const specific = groupFor(OUR_USER_AGENT.toLowerCase());
  const wildcard = groupFor("*");
  const applicable = specific ?? wildcard;

  const rules = applicable?.rules ?? [];
  const crawlDelayMs = applicable?.crawlDelayMs ?? 0;

  function isAllowed(path: string): boolean {
    // Longest-match-wins across Allow/Disallow, per the de-facto robots.txt spec.
    let best: { prefix: string; allow: boolean } | null = null;
    for (const rule of rules) {
      if (path.startsWith(rule.prefix)) {
        if (!best || rule.prefix.length > best.prefix.length) best = rule;
      }
    }
    return best ? best.allow : true;
  }

  return { isAllowed, crawlDelayMs, sitemaps };
}

const cache = new Map<string, Promise<RobotsRules>>();

async function fetchRobotsUncached(origin: string): Promise<RobotsRules> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  try {
    const url = await assertPublicHttpUrl(robotsUrl);
    const res = await fetch(url, {
      headers: { "user-agent": "RealwiseBot/1.0 (+https://realwise.com.br)" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) {
      return { isAllowed: () => true, crawlDelayMs: 0, sitemaps: [] };
    }
    if (res.status >= 500) {
      return { isAllowed: () => false, crawlDelayMs: 0, sitemaps: [] };
    }
    if (!res.ok) {
      return { isAllowed: () => true, crawlDelayMs: 0, sitemaps: [] };
    }
    const body = await res.text();
    return parseRobotsTxt(body);
  } catch {
    // Network/SSRF failures fail open — the per-request safeFetch SSRF checks still apply to
    // every actual page fetch, so this isn't a safety gap, just a politeness-signal miss.
    return { isAllowed: () => true, crawlDelayMs: 0, sitemaps: [] };
  }
}

export async function fetchRobots(origin: string): Promise<RobotsRules> {
  let cached = cache.get(origin);
  if (!cached) {
    cached = fetchRobotsUncached(origin);
    cache.set(origin, cached);
  }
  return cached;
}
