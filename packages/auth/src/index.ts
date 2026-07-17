import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import type { Role } from "@realwise/contracts";

const PASSWORD_ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export type SessionToken = {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
};

export type TenantContext = {
  tenantId: string;
  userId: string;
  role: Role;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, KEY_LENGTH, DIGEST).toString("base64url");
  return `pbkdf2-${DIGEST}$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, iterationsText, salt, expectedHash] = stored.split("$");
  if (algorithm !== `pbkdf2-${DIGEST}` || !iterationsText || !salt || !expectedHash) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < PASSWORD_ITERATIONS) return false;
  const actual = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
  const expected = Buffer.from(expectedHash, "base64url");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function createSessionToken(ttlMs = 1000 * 60 * 60 * 24 * 30): SessionToken {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

export function assertRole(role: Role, allowed: Role[]): void {
  if (!allowed.includes(role)) {
    throw new Error("Forbidden");
  }
}
