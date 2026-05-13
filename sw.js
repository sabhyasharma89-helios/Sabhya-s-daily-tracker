// FitCoach service worker
const CACHE = 'fitcoach-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/state.js',
  './js/utils.js',
  './js/profile.js',
  './js/data/foods.js',
  './js/data/exercises.js',
  './js/engine/meals.js',
  './js/engine/workout.js',
  './js/engine/correction.js',
  './js/coach/rules.js',
  './js/coach/claude.js',
  './js/views/today.js',
  './js/views/log.js',
  './js/views/coach.js',
  './js/views/trends.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(APP_SHELL).catch(err => console.warn('SW cache.addAll partial fail:', err))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Anthropic API
  if (url.hostname.includes('anthropic.com')) {
    return;
  }

  // CDN ESM modules — cache-first, stale-while-revalidate
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Same-origin: cache-first for static, network-first for HTML
  if (url.origin === self.location.origin) {
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
      event.respondWith(networkFirst(event.request));
    } else {
      event.respondWith(cacheFirst(event.request));
    }
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(resp => {
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  }).catch(() => cached);
  return cached || fetchPromise;
}
