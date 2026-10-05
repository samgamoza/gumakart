/* Guma Kart POS — offline shell (Phase 12b).
 *
 * Scope: /pos only. Lets the register screen open with no internet:
 *  - /pos pages: network first, the last good copy when offline;
 *  - app code (/_next/static) and same-site images: cache first (file names change per deploy);
 *  - /api/* is never cached — sales made offline are kept by the page itself and sent later.
 */
const VERSION = "gk-pos-v1";
const SHELL = "/pos";
const MAX_ENTRIES = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(new Request(SHELL, { credentials: "include" })))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("gk-pos-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)));
}

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>POS offline</title><body style="font-family:system-ui;background:#0A0F1D;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0">' +
  '<div style="max-width:22rem;text-align:center;padding:1rem"><p style="font-weight:700">No internet</p>' +
  "<p>Open the register once while online so it can work offline next time.</p>" +
  '<button onclick="location.reload()" style="margin-top:1rem;padding:.6rem 1rem;border-radius:.75rem;border:1px solid #475569;background:none;color:inherit">Try again</button></div>';

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    if (!(url.pathname === "/pos" || url.pathname.startsWith("/pos/"))) return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(url.pathname)) || (await caches.match(SHELL)) || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    );
    return;
  }

  const cacheable =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(png|jpe?g|webp|avif|gif|svg|woff2?|ico)$/.test(url.pathname);
  if (!cacheable) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        cache.put(req, res.clone()).then(() => trim(cache));
      }
      return res;
    })
  );
});
