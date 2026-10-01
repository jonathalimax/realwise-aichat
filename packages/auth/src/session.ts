import { SignJWT, jwtVerify } from "jose";

const SESSION_SECRET = new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-secret-change-me");

export interface BusinessSessionClaims {
  businessId: string;
  phoneNumber: string;
}

export interface VisitorSessionClaims {
  businessId: string;
  leadId?: string;
  phoneNumber?: string;
  name?: string;
}

export async function signBusinessSession(claims: BusinessSessionClaims): Promise<string> {
  return new SignJWT({ ...claims, kind: "business" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(SESSION_SECRET);
}

export async function signVisitorSession(claims: VisitorSessionClaims): Promise<string> {
  return new SignJWT({ ...claims, kind: "visitor" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(SESSION_SECRET);
}

export async function verifySession<T>(token: string): Promise<T> {
  const { payload } = await jwtVerify(token, SESSION_SECRET);
  return payload as unknown as T;
}
