// web/public/sw.js: tossa Service Worker for Offline & Disaster Resilience
const CACHE_NAME = 'tossa-shell-v1';
const API_CACHE_NAME = 'tossa-api-v1';
const TILE_CACHE_NAME = 'tossa-tiles-v1';

const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
];

// Install: precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate: purge older caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (
              name !== CACHE_NAME &&
              name !== API_CACHE_NAME &&
              name !== TILE_CACHE_NAME
            ) {
              return caches.delete(name);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (mutations like POST/PUT/DELETE handled by app & offline queue)
  if (request.method !== 'GET') {
    return;
  }

  // 1. Navigation requests (HTML SPA Shell) -> Network first, fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || Response.error();
        })
    );
    return;
  }

  // 2. Read-only API routes (/api/posts, /api/categories, /api/settings, /api/feed.json)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response.status === 200) {
            const clone = response.clone();
            caches
              .open(API_CACHE_NAME)
              .then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Network failed (offline/disaster) -> serve from API cache
          const cached = await caches.match(request);
          if (cached) {
            return cached;
          }
          return new Response(
            JSON.stringify({
              error: 'Offline and no cached data available',
              offline: true,
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        })
    );
    return;
  }

  // 3. Map tile requests (OpenStreetMap & GSI) -> Cache-first with offline fallback tile
  const isTileRequest =
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('cyberjapandata.gsi.go.jp');

  if (isTileRequest) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (tileCache) => {
        const cached = await tileCache.match(request);
        if (cached) {
          return cached;
        }

        try {
          const networkResponse = await fetch(request);
          if (
            networkResponse.status === 200 ||
            networkResponse.type === 'opaque'
          ) {
            tileCache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // Offline fallback tile: subtle checkered or clean grey tile indicating offline
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/><path d="M0 0 L256 256 M256 0 L0 256" stroke="#f1f5f9" stroke-width="1"/><text x="128" y="128" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="12" font-family="system-ui, -apple-system, sans-serif">Offline</text></svg>',
            {
              status: 200,
              headers: {
                'Content-Type': 'image/svg+xml',
                'Cache-Control': 'no-store',
              },
            }
          );
        }
      })
    );
    return;
  }

  // 4. Static assets (assets/*.js, assets/*.css, images, fonts) -> Stale-while-revalidate / Cache-first
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// 5. Web Push Notification Event
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'tossa 防災情報';
  const options = {
    body: data.body || '新しい情報があります。',
    icon: data.icon || '/favicon.svg',
    badge: data.badge || '/favicon.svg',
    tag: data.tag || 'tossa-alert',
    renotify: true,
    requireInteraction: data.requireInteraction ?? true,
    vibrate: data.vibrate || [200, 100, 200, 100, 300],
    data: {
      url: data.url || '/',
      timestamp: Date.now(),
      ...(data.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 6. Notification Click Event: Focus existing window or open new window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Look for an existing open window under the same origin
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client && targetUrl !== '/') {
              client.navigate(targetUrl);
            }
            return client.focus();
          }
        }
        // If no open client exists, open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
