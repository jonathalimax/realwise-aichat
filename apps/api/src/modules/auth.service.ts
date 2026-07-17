import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createSessionToken, hashPassword, hashToken, verifyPassword } from "@realwise/auth";
import { eq, and, gt, isNull } from "drizzle-orm";
import { memberships, sessions, tenants, users } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";

@Injectable()
export class AuthService {
  constructor(private readonly databaseProvider: DatabaseProvider) {}

  async bootstrapOwner(input: { email: string; name: string; password: string; tenantName: string; segment: string }) {
    const db = this.databaseProvider.require();
    const passwordHash = hashPassword(input.password);
    const [user] = await db.insert(users).values({ email: input.email.toLowerCase(), name: input.name, passwordHash, emailVerifiedAt: new Date() }).returning();
    const [tenant] = await db.insert(tenants).values({ name: input.tenantName, segment: input.segment, releaseState: "IMPLEMENTED_NOT_VERIFIED" }).returning();
    if (!user || !tenant) throw new Error("Failed to create bootstrap records");
    await db.insert(memberships).values({ tenantId: tenant.id, userId: user.id, role: "OWNER" });
    const session = createSessionToken();
    await db.insert(sessions).values({ userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt });
    return { user: { id: user.id, email: user.email, name: user.name }, tenant: { id: tenant.id, name: tenant.name, segment: tenant.segment }, sessionToken: session.rawToken };
  }

  async login(input: { email: string; password: string }) {
    const db = this.databaseProvider.require();
    const [user] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
    if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos.", supportCode: "RW-AUTH-003" });
    }
    const session = createSessionToken();
    await db.insert(sessions).values({ userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt });
    return { user: { id: user.id, email: user.email, name: user.name }, sessionToken: session.rawToken };
  }

  async resolveSession(rawToken: string) {
    const db = this.databaseProvider.require();
    const [session] = await db.select().from(sessions).where(and(eq(sessions.tokenHash, hashToken(rawToken)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))).limit(1);
    if (!session) throw new UnauthorizedException({ code: "SESSION_INVALID", message: "Sessão inválida.", supportCode: "RW-AUTH-004" });
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    const tenantMemberships = await db.select().from(memberships).where(eq(memberships.userId, session.userId));
    return { user, memberships: tenantMemberships };
  }

  async logout(rawToken: string) {
    const db = this.databaseProvider.require();
    await db.update(sessions).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(rawToken)));
    return { ok: true };
  }
}
