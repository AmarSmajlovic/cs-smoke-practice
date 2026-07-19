// Cache-first service worker for the big map/model binaries. Mobile browsers
// happily evict 60MB entries from the plain HTTP cache (or refuse to store
// them at all), so repeat visits kept re-downloading the map — Cache Storage
// holds them reliably. Versioned URLs (?v=N) key the entries; when a new
// version lands, the stale one for the same path is dropped.
const CACHE = 'sp-assets-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (url.origin !== location.origin) return;
    if (e.request.method !== 'GET') return;
    if (!/^\/(maps|models)\//.test(url.pathname)) return;

    e.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(e.request.url);
        if (hit) return hit;
        const resp = await fetch(e.request);
        if (resp.ok) {
            await cache.put(e.request.url, resp.clone());
            // drop stale versions of the same file (?v= changed)
            for (const k of await cache.keys()) {
                const ku = new URL(k.url);
                if (ku.pathname === url.pathname && ku.search !== url.search) await cache.delete(k);
            }
        }
        return resp;
    })());
});
