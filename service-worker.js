/**
 * FOODIE — Service Worker
 * =======================
 * Strategie: Cache-First für App-Shell (offline-first).
 * Netzwerk-First für Bild-URLs (externe Ressourcen).
 *
 * Cache-Strategie:
 *  - App-Shell: bei Install cachen, dann immer aus Cache servieren
 *  - Bilder (extern): Netzwerk versuchen, Cache als Fallback
 *  - Schriften: Cache mit Network-Fallback
 */

const CACHE_NAME     = 'foodie-v1';
const RUNTIME_CACHE  = 'foodie-runtime-v1';
const FONT_CACHE     = 'foodie-fonts-v1';

/** App-Shell: Diese Dateien werden beim Install gecacht */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-maskable.svg',
];

/** Schrift-Origins, die gecacht werden sollen */
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];


/* ================================================
   INSTALL — App-Shell pre-cachen
   ================================================ */

self.addEventListener('install', (event) => {
  console.log('[Foodie SW] Install — pre-caching App-Shell...');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // Sofort aktivieren (nicht auf alte Clients warten)
      return self.skipWaiting();
    }).catch((err) => {
      console.error('[Foodie SW] Pre-caching fehlgeschlagen:', err);
    })
  );
});


/* ================================================
   ACTIVATE — Alte Caches aufräumen
   ================================================ */

self.addEventListener('activate', (event) => {
  console.log('[Foodie SW] Aktiviert — alte Caches werden bereinigt...');

  const validCaches = [CACHE_NAME, RUNTIME_CACHE, FONT_CACHE];

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !validCaches.includes(name))
          .map((name) => {
            console.log('[Foodie SW] Entferne alten Cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Sofort alle Clients übernehmen
      return self.clients.claim();
    })
  );
});


/* ================================================
   FETCH — Anfragen abfangen und bedienen
   ================================================ */

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nur GET-Anfragen behandeln
  if (event.request.method !== 'GET') return;

  // --- Schriften: Stale-while-revalidate ---
  if (FONT_ORIGINS.some(origin => url.href.startsWith(origin))) {
    event.respondWith(cacheFirstWithNetwork(event.request, FONT_CACHE));
    return;
  }

  // --- App-Shell (gleicher Origin): Cache-First ---
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithFallback(event.request));
    return;
  }

  // --- Externe Bilder: Network-First mit Cache-Fallback ---
  if (event.request.destination === 'image') {
    event.respondWith(networkFirstWithCache(event.request, RUNTIME_CACHE));
    return;
  }

  // --- Alles andere: Netzwerk pur ---
  // (keine Aktion → Browser übernimmt normal)
});


/* ================================================
   HILFSFUNKTIONEN (Fetch-Strategien)
   ================================================ */

/**
 * Cache-First: Aus Cache servieren. Wenn nicht gecacht,
 * vom Netzwerk laden und in Cache speichern.
 * Fallback: Offline-Meldung oder leere Response.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirstWithFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline-Fallback: index.html ausliefern (SPA-Routing)
    const fallback = await caches.match('/index.html');
    return fallback || new Response('Offline — bitte später versuchen.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/**
 * Cache-First mit Netzwerk-Hintergrund-Update (Schriften).
 * Serviert sofort aus Cache, aktualisiert im Hintergrund.
 * @param {Request} request
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);

  const networkFetch = fetch(request).then((response) => {
    if (response.ok) {
      caches.open(cacheName).then(c => c.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cached || await networkFetch || new Response('', { status: 404 });
}

/**
 * Network-First: Netzwerk versuchen, bei Fehler aus Cache.
 * Geeignet für externe Bilder, die sich selten ändern.
 * @param {Request} request
 * @param {string} cacheName
 * @returns {Promise<Response>}
 */
async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 503 });
  }
}


/* ================================================
   NACHRICHTEN (für spätere Erweiterungen)
   ================================================ */

self.addEventListener('message', (event) => {
  // Cache manuell leeren (z.B. bei App-Update)
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
    event.ports[0]?.postMessage({ success: true });
  }

  // Cache-Version abfragen
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});
