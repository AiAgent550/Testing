// Makes the Hub installable on phones and shows its notifications. Pages and data always come from
// the network (customer data is never cached on the device); only an offline notice is kept.
const OFFLINE = new Response(
  '<!doctype html><meta name="viewport" content="width=device-width"><body style="background:#050608;color:#e9eef4;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>No connection. The Hub will be back when you are online.</p>',
  { headers: { "content-type": "text/html; charset=utf-8" } },
);
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => OFFLINE.clone()));
});

// ---------- notifications ----------
// The server encrypts each message for this device and writes it in the reader's language.
self.addEventListener("push", e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Curve Hub", body: e.data ? e.data.text() : "" }; }
  const url = typeof data.url === "string" && data.url.startsWith("/app/") ? data.url : "/app/";
  e.waitUntil(Promise.all([
    self.registration.showNotification(data.title || "Curve Hub", {
      body: data.body || "",
      icon: "/assets/icons/icon-192.png",
      badge: "/assets/icons/badge-96.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      timestamp: Date.now(),
      data: { url },
    }),
    // Let open Hub windows refresh their bell.
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => list.forEach(c => c.postMessage({ type: "notification" }))),
  ]));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "/app/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const hub = wins.find(w => new URL(w.url).pathname.startsWith("/app"));
    if (hub) {
      await hub.focus();
      // Navigating within the dashboard is a hash change, so tell the page instead of reloading it.
      hub.postMessage({ type: "open", url: target });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
