import { lookup } from "dns/promises";
import ipaddr from "ipaddr.js";

function isBlockedIp(address: string): boolean {
  try {
    return ipaddr.process(address).range() !== "unicast";
  } catch {
    return true; // unparsable — treat as unsafe
  }
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("URL must use https");
  }

  const addresses = await lookup(parsed.hostname, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new Error("Could not resolve hostname");
  if (addresses.some((a) => isBlockedIp(a.address))) {
    throw new Error("URL resolves to a private, loopback, or link-local address");
  }

  return parsed;
}

export { isBlockedIp };
