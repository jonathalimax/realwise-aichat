// Plain service worker, no build step — handles Web Push delivery for owner-reply notifications
// (see apps/api/src/modules/push). Phase 2/3 notifications will reuse the same listeners.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Nova mensagem";
  const options = {
    body: payload.body || "",
    tag: payload.tag,
    renotify: true,
    // The widget lives under a base path: assets and the default link are resolved against the worker's own scope.
    icon: new URL("clara-avatar.jpg", self.registration.scope).href,
    badge: new URL("clara-avatar.jpg", self.registration.scope).href,
    data: { url: payload.url || self.registration.scope },
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
