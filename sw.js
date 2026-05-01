const CACHE_NAME = 'task-tracker-v1';
const STATIC_ASSETS = [
  '/sabhya-s-daily-tracker/',
  '/sabhya-s-daily-tracker/index.html',
  '/sabhya-s-daily-tracker/style.css',
  '/sabhya-s-daily-tracker/js/db.js',
  '/sabhya-s-daily-tracker/js/auth.js',
  '/sabhya-s-daily-tracker/js/gmail.js',
  '/sabhya-s-daily-tracker/js/parser.js',
  '/sabhya-s-daily-tracker/js/tasks.js',
  '/sabhya-s-daily-tracker/js/ui.js',
  '/sabhya-s-daily-tracker/js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Network-first for Google APIs, cache-first for static assets
  if (url.hostname.includes('google') || url.hostname.includes('googleapis')) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
