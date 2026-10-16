import { SignJWT, jwtVerify } from "jose";

function loadSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error("SESSION_SECRET must be set to a strong value (>=32 chars)");
  }
  return new TextEncoder().encode(raw);
}

let cachedSecret: Uint8Array | undefined;
function secret(): Uint8Array {
  if (!cachedSecret) cachedSecret = loadSecret();
  return cachedSecret;
}

export interface BusinessSessionClaims {
  businessId: string;
  /** Firebase-verified phone (owner phone login) or the member's email / phone for password logins. */
  phoneNumber: string;
  // Team & access. Absent on sessions issued before the team feature: the API then resolves the
  // business's primary Owner member. `permissions` is informational (UI hints at login time); the
  // server always re-resolves role + permissions from the DB on every request (instant revocation).
  memberId?: string;
  roleId?: string;
  roleKey?: string | null;
  permissions?: Record<string, string>;
}

export interface VisitorSessionClaims {
  businessId: string;
  leadId?: string;
  phoneNumber?: string;
  name?: string;
}

export interface AdminSessionClaims {
  adminId: string;
  role: "superadmin" | "support";
}

export async function signBusinessSession(claims: BusinessSessionClaims): Promise<string> {
  return new SignJWT({ ...claims, kind: "business" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function signVisitorSession(claims: VisitorSessionClaims): Promise<string> {
  return new SignJWT({ ...claims, kind: "visitor" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function signAdminSession(claims: AdminSessionClaims): Promise<string> {
  return new SignJWT({ ...claims, kind: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

async function verifyKind<T>(token: string, kind: "business" | "visitor" | "admin"): Promise<T> {
  const { payload } = await jwtVerify(token, secret());
  if (payload.kind !== kind) {
    throw new Error(`Expected ${kind} session, got ${payload.kind}`);
  }
  return payload as unknown as T;
}

export async function verifyBusinessSession(token: string): Promise<BusinessSessionClaims> {
  return verifyKind<BusinessSessionClaims>(token, "business");
}

export async function verifyVisitorSession(token: string): Promise<VisitorSessionClaims> {
  return verifyKind<VisitorSessionClaims>(token, "visitor");
}

export async function verifyAdminSession(token: string): Promise<AdminSessionClaims> {
  return verifyKind<AdminSessionClaims>(token, "admin");
}
