import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus, Type } from "@nestjs/common";

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  // Login endpoints have no visitor-session cookie yet (they ARE the login step), so this keys by IP only.
  ipOnly?: boolean;
}

function createRateLimitGuard(options: RateLimitOptions): Type<CanActivate> {
  const { windowMs, maxRequests, ipOnly } = options;
  const hits = new Map<string, number[]>();

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const kept = timestamps.filter((t) => t > cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }, windowMs).unref();

  @Injectable()
  class ScopedRateLimitGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest();
      const visitorToken = !ipOnly && (req.visitor?.visitorToken ?? req.visitor?.leadId);
      const key = visitorToken ? `v:${visitorToken}` : `ip:${req.ip}`;

      const now = Date.now();
      const cutoff = now - windowMs;
      const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);

      if (timestamps.length >= maxRequests) {
        throw new HttpException("Too many requests — devagar um pouco.", HttpStatus.TOO_MANY_REQUESTS);
      }

      timestamps.push(now);
      hits.set(key, timestamps);
      return true;
    }
  }

  return ScopedRateLimitGuard;
}

// Default guard used by chat/public endpoints: 20 requests/minute, visitor-token-aware.
export const RateLimitGuard = createRateLimitGuard({ windowMs: 60_000, maxRequests: 20 });

// Tighter, IP-only guard for login/OTP-verification endpoints (brute-force sensitive).
// This is in-memory/per-process, so it's a soft backstop, not the real limit — Firebase's own
// SMS quota per phone/IP is what actually caps abuse. Raised from 10 to accommodate self-serve
// signup traffic (send + confirm each count as a hit) without false-locking legitimate users.
export const AuthRateLimitGuard = createRateLimitGuard({ windowMs: 15 * 60_000, maxRequests: 30, ipOnly: true });
