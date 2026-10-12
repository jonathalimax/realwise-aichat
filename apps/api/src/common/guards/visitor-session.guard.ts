import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { verifyVisitorSession } from "@realwise/auth";
import { randomUUID } from "crypto";

const ANON_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  // 30 days — long enough for a slow-considering lead to come back on the same device/browser,
  // short enough to not be a permanent fingerprint.
  maxAge: 30 * 24 * 3600 * 1000,
};

@Injectable()
export class VisitorSessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const businessId = req.params?.businessId;

    const sessionToken = req.cookies?.rw_visitor_session;
    if (sessionToken) {
      try {
        const claims = await verifyVisitorSession(sessionToken);
        // An identified-visitor session only applies to the business it was issued for — a
        // stale cookie from a different business's chat link must fall through to anonymous
        // rather than block the request or silently mix tenants.
        if (!businessId || claims.businessId === businessId) {
          req.visitor = claims;
          return true;
        }
      } catch {
        // falls through to anonymous
      }
    }

    // Pre-identification visitor (hasn't gone through /auth/visitor/identify yet): persist a
    // lightweight, non-sensitive correlation id via its own cookie so repeated requests (start
    // conversation, then send message) share the same identity — without this, every anonymous
    // request minted a fresh random token and ChatService's ownership check always failed.
    let anonToken = req.cookies?.[`rw_visitor_anon_${businessId}`];
    if (!anonToken) {
      anonToken = randomUUID();
      res.cookie(`rw_visitor_anon_${businessId}`, anonToken, ANON_COOKIE_OPTIONS);
    }
    req.visitor = { visitorToken: anonToken };
    return true;
  }
}
