// Cache-first service worker for the big map/model binaries. Mobile browsers
// happily evict 60MB entries from the plain HTTP cache (or refuse to store
// them at all), so repeat visits kept re-downloading the map — Cache Storage
// holds them reliably. Versioned URLs (?v=N) key the entries.
//
// HARD RULE: this SW must never make a request FAIL. Any caching error falls
// straight through to a normal network fetch — a broken cache must degrade to
// "download again", never to "map won't load".
const CACHE = 'sp-assets-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil((async () => {
    // drop caches from any earlier SW version (incl. a poisoned v1 entry)
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (url.origin !== location.origin) return;
    if (e.request.method !== 'GET') return;
    if (!/^\/(maps|models)\//.test(url.pathname)) return;

    e.respondWith((async () => {
        const key = url.pathname + url.search;
        try {
            const cache = await caches.open(CACHE);
            const hit = await cache.match(key);
            if (hit) return hit;
            const resp = await fetch(e.request);
            // Only store complete 200 bodies (never 206 range — cache.put
            // rejects those). Caching is fire-and-forget: a put failure (quota,
            // etc.) must not touch the response we return.
            if (resp && resp.status === 200) {
                const copy = resp.clone();
                cache.put(key, copy).then(async () => {
                    for (const k of await cache.keys()) {
                        const ku = new URL(k.url);
                        if (ku.pathname === url.pathname && ku.pathname + ku.search !== key) await cache.delete(k);
                    }
                }).catch(() => {});
            }
            return resp;
        } catch (err) {
            return fetch(e.request); // last-resort: plain network, never fail
        }
    })());
});
