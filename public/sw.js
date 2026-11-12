// Lets Buildsasa open on a site with weak or no signal (idea.md 6.3).
// Pages: network first, the last good copy when offline (so a new release is
// picked up as soon as there's signal). Built assets (hashed file names never
// change): cache first. API calls are never cached here; the outbox in the app
// keeps unsent work.
const CACHE = "buildsasa-shell-v1";

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"]).catch(() => {}))); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("buildsasa-shell-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // the API and other hosts: untouched
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return res; })
      .catch(() => caches.match("/").then((r) => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|ico|webp|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
  }
});
