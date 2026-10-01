import { lookup } from "dns/promises";
import { isIP } from "net";

function isBlockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 0) return true; // unspecified
    return false;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized === "::") return true; // unspecified
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    if (normalized.startsWith("::ffff:")) return isBlockedIp(normalized.replace("::ffff:", ""));
    return false;
  }
  return true; // not a valid IP at all — treat as unsafe
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL must use http or https");
  }

  const addresses = await lookup(parsed.hostname, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new Error("Could not resolve hostname");
  if (addresses.some((a) => isBlockedIp(a.address))) {
    throw new Error("URL resolves to a private, loopback, or link-local address");
  }

  return parsed;
}
