/* canvas.me service worker. Generated at build time by scripts/build-sw.mjs; do not edit out/sw.js. */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `canvasme-${VERSION}`;
const RUNTIME = "canvasme-runtime";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("canvasme-") && k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// The page asks the waiting worker to take over only when the user clicks "Reload".
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(req.mode === "navigate" ? navigate(req, url) : sameOrigin(req));
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(req));
});

// Pages come from this version's cache so HTML and its scripts always match.
// Query strings (/app/edit?id=…, /app?size=…) are app state, not different files.
async function navigate(req, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url.pathname, { ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch {
    const shell = url.pathname.startsWith("/app") ? "/app" : "/";
    return (await cache.match(shell)) || Response.error();
  }
}

async function sameOrigin(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(RUNTIME).then((cache) => cache.put(req, copy));
  }
  return res;
}

// Google Fonts used by designs: serve from cache instantly, refresh in the background.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
}
