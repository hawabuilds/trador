/**
 * Minimal offline shell: bootstrap JSON and static brand assets only.
 * Coin pages and wallet data stay network-first.
 */

const CACHE = "trador-shell-v1";
const PRECACHE = ["/brand/favicon-128.png", "/brand/apple-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  if (url.pathname === "/api/home/bootstrap") {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  if (url.pathname.startsWith("/brand/")) {
    event.respondWith(cacheFirst(event.request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    void cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return (
    cached ??
    (await network) ??
    new Response(JSON.stringify({error: "offline"}), {
      status: 503,
      headers: {"content-type": "application/json"},
    })
  );
}
