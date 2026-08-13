const CACHE_NAME = 'job-costing-v1';
const CSV_URL_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQF-dVNCimVYFht-LgwEeKT4rEtW-IDphibc5oSV60YBjLxGn4KGT45nU2U58EfBCYbF0UdDxdoe88r/pub?gid=0&single=true&output=csv';
const URLS_TO_CACHE = [
  '/',
  'https://cdn.tailwindcss.com?plugins=forms,container-queries',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cache-first / Stale-while-revalidate for the CSV
  if (url.href.startsWith(CSV_URL_BASE) || url.pathname.endsWith('.csv')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          const fetchPromise = fetch(event.request).then(networkResponse => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          }).catch(() => cachedResponse); // Fallback to cache if network fails
          return cachedResponse || fetchPromise;
        });
      })
    );
  } else {
    // Standard cache-first for other assets
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request).then(fetchRes => {
          return caches.open(CACHE_NAME).then(cache => {
            if (event.request.method === 'GET' && !url.href.startsWith('chrome-extension')) {
              cache.put(event.request, fetchRes.clone());
            }
            return fetchRes;
          });
        }).catch(() => {
          // Ignore or return offline fallback
        });
      })
    );
  }
});
