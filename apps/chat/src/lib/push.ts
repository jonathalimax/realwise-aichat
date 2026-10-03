import { getPushPublicKey, subscribePush } from "./api";

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
  businessId: string,
  conversationId: string,
): Promise<"granted" | "denied" | "unsupported" | "error"> {
  if (!isPushSupported()) return "unsupported";

  try {
    const { publicKey } = await getPushPublicKey(businessId);
    if (!publicKey) return "error";

    const registration = await navigator.serviceWorker.register("/sw.js");
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
