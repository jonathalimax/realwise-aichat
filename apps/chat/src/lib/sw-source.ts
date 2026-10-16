// Source of the push service worker, served by app/[slug]/chat/sw.js/route.ts. It is a route (not a file in /public)
// because a worker's scope is capped by its own path: it must live under /<slug>/ to control /<slug>/chat and
// /<slug>/pedido/*, and the chat app shares the domain root with other apps (see docs/pharmacy/URLS.md).
import { ASSET_PREFIX } from "./asset-prefix";

export const SW_SOURCE = `// Plain service worker, no build step: Web Push delivery for owner/pharmacist-reply notifications.
const ASSET_PREFIX = ${JSON.stringify(ASSET_PREFIX)};

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Nova mensagem";
  const icon = new URL(ASSET_PREFIX + "/clara-avatar.jpg", self.location.origin).href;
  const options = {
    body: payload.body || "",
    tag: payload.tag,
    renotify: true,
    icon,
    badge: icon,
    // The chat lives at <scope>chat (scope is /<slug>/); the API normally sends the full link.
    data: { url: payload.url || new URL("chat", self.registration.scope).href },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(new URL(url, self.location.origin).pathname) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
`;
