const CACHE_NAME = "scada-pm-hub-cache-v1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./public/favicon.svg",
  "./public/favicon.ico",
  "./public/apple-touch-icon.png",
  "./public/icon-192.png",
  "./public/icon-512.png",
  "./public/icon-maskable-512.png"
];

// Install: pre-cache the core app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for core assets, network-first fallback for everything else.
// Note: GitHub API calls (api.github.com) are always passed through to the
// network so issue dispatch never serves a stale/cached response.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept GitHub API or third-party module requests.
  if (
    url.origin.includes("api.github.com") ||
    url.origin.includes("esm.sh") ||
    url.origin.includes("tailwindcss.com")
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Cache a copy of successfully fetched same-origin assets
          if (response && response.status === 200 && event.request.method === "GET") {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: serve the shell for navigation requests
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
    })
  );
});
