// Service worker: network-first with a cache fallback. When online you always
// get the latest files (no stale-cache surprises during development); when
// offline the app still loads from the last cached copy. Bump CACHE to force a
// clean refresh of precached assets.
const CACHE = "capybaradoku-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/game.js",
  "./src/scoreboard.js",
  "./src/generator.js",
  "./src/solver.js",
  "./src/rng.js",
  "./src/levels.json",
  "./assets/capybara.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // refresh the cache with the latest copy
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        // offline: fall back to cache, then to the app shell
        caches.match(e.request).then((hit) => hit || caches.match("./index.html"))
      )
  );
});
