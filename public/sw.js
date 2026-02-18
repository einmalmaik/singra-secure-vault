const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'singra-pwa-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';
const APP_SHELL = [OFFLINE_URL, '/manifest.webmanifest', '/favicon.ico', '/singra-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cachedOffline = await caches.match(OFFLINE_URL);
    return cachedOffline || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

function isCacheableAsset(pathname) {
  return pathname.startsWith('/assets/');
}

async function staleWhileRevalidateAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  return (await fetchPromise) || new Response('Offline', { status: 503, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCacheableAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidateAsset(request));
  }
});

// ============ Support Reply Notifications ============

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data && event.data.type === 'SUPPORT_REPLY_NOTIFICATION') {
    const { title, body, url } = event.data;
    self.registration.showNotification(title || 'Singra PW Support', {
      body: body || 'Du hast eine neue Support-Antwort.',
      icon: '/singra-icon.png',
      badge: '/singra-icon.png',
      tag: 'support-reply',
      data: { url: url || '/vault' },
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/vault';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
