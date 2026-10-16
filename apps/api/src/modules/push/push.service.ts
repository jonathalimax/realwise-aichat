import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import * as webpush from "web-push";
import { PrismaService } from "../../prisma/prisma.service";

const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  "web.push.apple.com",
];

/** Key material of a browser PushSubscription: p256dh is an uncompressed P-256 point (65 bytes, 0x04 prefix), auth is 16 random bytes. */
export function hasValidPushKeys(keys: { p256dh?: unknown; auth?: unknown } | undefined | null): boolean {
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return false;
  const b64url = /^[A-Za-z0-9_-]+={0,2}$/;
  if (!b64url.test(keys.p256dh) || !b64url.test(keys.auth)) return false;
  const p256dh = Buffer.from(keys.p256dh, "base64url");
  const auth = Buffer.from(keys.auth, "base64url");
  return p256dh.length === 65 && p256dh[0] === 4 && auth.length === 16;
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const MAX_ENDPOINT_LENGTH = 1000;
const MAX_FAILURE_COUNT = 5;

// Phase 1 of push notifications: owner-reply delivery to visitors who opted in conversationally
// (see InboxService.sendOwnerMessage). Phase 2 (re-engagement nudges) and Phase 3 (appointment
// reminders) are expected to reuse sendToConversation() below with different payloads — the
// subscription storage/VAPID plumbing is deliberately generic, not owner-reply-specific.
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private vapidConfigured = false;
  private warnedOnce = false;

  constructor(private readonly prisma: PrismaService) {
    this.configureVapid();
  }

  private configureVapid() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
      if (!this.warnedOnce) {
        this.logger.warn(
          "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not set — push notifications are disabled (no-op).",
        );
        this.warnedOnce = true;
      }
      return;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.vapidConfigured = true;
  }

  publicKey(): string | null {
    return this.vapidConfigured ? (process.env.VAPID_PUBLIC_KEY as string) : null;
  }

  async subscribe(
    businessId: string,
    conversationId: string,
    sub: PushSubscriptionKeys,
    userAgent?: string,
  ) {
    if (!sub?.endpoint || sub.endpoint.length >= MAX_ENDPOINT_LENGTH || !isAllowedPushEndpoint(sub.endpoint)) {
      throw new BadRequestException("Invalid push subscription endpoint");
    }
    if (!hasValidPushKeys(sub.keys)) {
      throw new BadRequestException("Invalid push subscription keys");
    }

    const existing = await this.prisma.client.pushSubscription.findUnique({
      where: { endpoint: sub.endpoint },
    });
    if (existing && existing.conversationId !== conversationId) {
      // A push endpoint is unique per browser install, not per conversation — a different
      // conversation claiming the same endpoint would let it hijack another visitor's
      // subscription (or receive their notifications) rather than register its own.
      throw new ForbiddenException("This push endpoint is already registered to another conversation");
    }

    return this.prisma.client.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        businessId,
        conversationId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
      },
      update: {
        businessId,
        conversationId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
        revokedAt: null,
        failureCount: 0,
      },
    });
  }

  async unsubscribe(conversationId: string, endpoint: string) {
    await this.prisma.client.pushSubscription.updateMany({
      where: { conversationId, endpoint },
      data: { revokedAt: new Date() },
    });
  }

  async sendToConversation(conversationId: string, payload: PushPayload) {
    if (!this.vapidConfigured) return;

    const subscriptions = await this.prisma.client.pushSubscription.findMany({
      where: { conversationId, revokedAt: null },
    });
    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);
    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
            // A dead push service must not hold the reply flow: give up after 10 s (counts as a failure).
            { TTL: 24 * 3600, timeout: 10_000 },
          );
          await this.prisma.client.pushSubscription.update({
            where: { id: sub.id },
            data: { lastSentAt: new Date() },
          });
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.client.pushSubscription.update({
              where: { id: sub.id },
              data: { revokedAt: new Date() },
            });
            return;
          }
          const nextFailureCount = sub.failureCount + 1;
          await this.prisma.client.pushSubscription.update({
            where: { id: sub.id },
            data: {
              failureCount: nextFailureCount,
              ...(nextFailureCount >= MAX_FAILURE_COUNT ? { revokedAt: new Date() } : {}),
            },
          });
        }
      }),
    );
  }
}
