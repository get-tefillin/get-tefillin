// Get Tefillin — service worker: caches the app shell; the API and admin always go to the network.
const CACHE = "tn-shell-v25";
const SHELL = ["/active-map.js?v=3","/announcements.js?v=13","/", "/styles.css?v=17", "/app.js?v=24", "/config.js?v=11", "/i18n.js?v=11", "/vendor/leaflet.css", "/vendor/leaflet.js", "/map/", "/map/map.js?v=17", "/map/map.css?v=16", "/icon.svg", "/fonts/Heebo.ttf", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== "tn-push-log").map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin") || url.pathname.startsWith("/.well-known/")) return;
  if (req.mode === "navigate") {
    // only the app's own page is kept for offline use (not /privacy or other pages)
    const isApp = url.pathname === "/" || url.pathname === "/index.html";
    e.respondWith(fetch(req).then(r => { if (isApp && r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put("/", c)); } return r; }).catch(() => isApp ? caches.match("/") : Response.error()));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

// v6: background alerts for shluchim (Web Push). The payload is encrypted end to end by the server.
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "Get Tefillin", body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Get Tefillin";
  const opts = { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.tag || "tn", renotify: true,
    requireInteraction: d.type === "req", vibrate: [300, 150, 300, 150, 300], data: { url: d.url || "/#vol", id: d.id || null, type: d.type || "" }, lang: "he", dir: "auto" };
  e.waitUntil(self.registration.showNotification(title, opts).then(() => pushLog(d, "shown"), x => pushLog(d, "error: " + (x && x.message))));
});
// a tiny on-device receipt of the last few alerts (type, request id, time, shown or not), for troubleshooting a phone
function pushLog(d, state) {
  return caches.open("tn-push-log").then(c => c.put("/__push/" + Date.now(), new Response(JSON.stringify({ type: d.type || "", id: d.id || null, at: Date.now(), state }), { headers: { "content-type": "application/json" } })))
    .then(() => caches.open("tn-push-log")).then(c => c.keys().then(ks => Promise.all(ks.slice(0, Math.max(0, ks.length - 10)).map(k => c.delete(k))))).catch(() => {});
}
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = new URL(data.url || "/#vol", self.location.origin).href;
  if (data.type === "announcement") { e.waitUntil(self.clients.openWindow(target)); return; }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) {
        c.postMessage({ type: "open_req", id: data.id, kind: data.type });
        return c.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : null;
  }));
});
