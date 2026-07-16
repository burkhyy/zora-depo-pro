const CACHE_NAME = "zoom-depo-v3.12.8";
const STATIC_ASSETS = [
    "/style.css?v=3.12.8",
    "/app.js?v=3.12.8",
    "/manifest.webmanifest",
    "/icons/zoom-depo-192.png",
    "/icons/zoom-depo-512.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== "GET" || url.origin !== self.location.origin) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).catch(() => caches.match("/"))
        );
        return;
    }

    if (url.pathname.startsWith("/orders")
        || url.pathname.startsWith("/order/")
        || url.pathname.startsWith("/products")
        || url.pathname.startsWith("/product-images")
        || url.pathname.startsWith("/product-image/")
        || url.pathname.startsWith("/locations")
        || url.pathname.startsWith("/shipments")
        || url.pathname.startsWith("/label-prints")
        || url.pathname.startsWith("/auth/")
        || url.pathname.startsWith("/admin/")
        || url.pathname.startsWith("/issues")
        || url.pathname.startsWith("/notifications")
        || url.pathname.startsWith("/api-status")
        || url.pathname.startsWith("/reports/")
        || url.pathname === "/preparations"
        || url.pathname.startsWith("/preparations/")) {
        return;
    }

    event.respondWith(
        fetch(request)
            .then(response => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request))
    );
});
