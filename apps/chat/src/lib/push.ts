import { getPushPublicKey, subscribePush, unsubscribePush } from "./api";

// The worker is served by app/[slug]/chat/sw.js/route.ts with `Service-Worker-Allowed: /<slug>/`, so the
// registration scope is `/<slug>/` (covers /<slug>/chat and /<slug>/pedido/*).
// Public files are requested under the assetPrefix (`/_c`, see next.config.mjs).
export { ASSET_PREFIX } from "./asset-prefix";
export const swUrl = (slug: string) => `/${encodeURIComponent(slug)}/chat/sw.js`;
export const swScope = (slug: string) => `/${encodeURIComponent(slug)}/`;

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// Standard base64url -> Uint8Array helper for the VAPID applicationServerKey, required by the
// Push API (which expects a BufferSource, not a plain base64url string).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function enablePush(
  slug: string,
  businessId: string,
  conversationId: string,
): Promise<"granted" | "denied" | "unsupported" | "error"> {
  if (!isPushSupported()) return "unsupported";

  try {
    const { publicKey } = await getPushPublicKey(businessId);
    if (!publicKey) return "error";

    const registration = await navigator.serviceWorker.register(swUrl(slug), { scope: swScope(slug) });
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return permission === "denied" ? "denied" : "error";

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await subscribePush(businessId, conversationId, subscription.toJSON());
    return "granted";
  } catch {
    return "error";
  }
}

/** Turns the notification off for this conversation: revokes it on the server, then drops the browser subscription. */
export async function disablePush(slug: string, businessId: string, conversationId: string): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration(swScope(slug));
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return true;
    await unsubscribePush(businessId, conversationId, subscription.endpoint);
    return await subscription.unsubscribe();
  } catch {
    return false;
  }
}
