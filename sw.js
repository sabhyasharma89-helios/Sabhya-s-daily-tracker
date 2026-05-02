/* ═══════════════════════════════════════════════════════
   SERVICE WORKER — CACHE + BACKGROUND HINTS
═══════════════════════════════════════════════════════ */

const CACHE_NAME = 'sabhya-tracker-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/auth.js',
  './js/database.js',
  './js/gmail.js',
  './js/processor.js',
  './js/ui.js',
  './js/app.js',
  './manifest.json',
];

// Install: pre-cache all static assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
});

// Activate: remove old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API calls, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Always go to network for Gmail / Anthropic APIs
  if (url.includes('googleapis.com') || url.includes('anthropic.com') || url.includes('accounts.google.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
