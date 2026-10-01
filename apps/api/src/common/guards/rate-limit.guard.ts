import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from "@nestjs/common";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

const hits = new Map<string, number[]>();

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of hits) {
    const kept = timestamps.filter((t) => t > cutoff);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
  }
}, WINDOW_MS).unref();

@Injectable()
export class RateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const visitorToken = req.visitor?.visitorToken ?? req.visitor?.leadId;
    const key = visitorToken ? `v:${visitorToken}` : `ip:${req.ip}`;

    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
      throw new HttpException("Too many requests — devagar um pouco.", HttpStatus.TOO_MANY_REQUESTS);
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  }
}
