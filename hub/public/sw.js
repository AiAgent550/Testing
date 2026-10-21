// Makes the Hub installable on phones. Pages and data always come from the network
// (customer data is never cached on the device); only an offline notice is kept.
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
