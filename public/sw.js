const SHELL_CACHE = "wo-shell-v1";
const TILE_CACHE = "wo-tiles-v1";
const MAX_TILES = 250;
const TILE_HOSTS = [
  "tile.openstreetmap.org",
  "basemaps.cartocdn.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (TILE_HOSTS.some((host) => url.hostname.endsWith(host))) {
    event.respondWith(cacheFirst(request, TILE_CACHE, MAX_TILES));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(networkFirst(request, SHELL_CACHE));
});

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trimCache(cache, maxEntries);
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const extra = keys.length - maxEntries;
  for (let i = 0; i < extra; i += 1) {
    await cache.delete(keys[i]);
  }
}
