/**
 * ============================================================
 * VICO ACTIVE — Service Worker v3.0
 * Autor: Jaime Andrés Dueñas Vicuña
 * Descripción: Caché offline, sincronización en segundo plano
 * ============================================================
 * CONFIGURACIÓN:
 * - CACHE_NAME: cambiar versión al actualizar assets
 * - STATIC_ASSETS: lista de archivos a cachear
 * ============================================================
 */

const CACHE_NAME = 'vico-active-v3.0';
const DYNAMIC_CACHE = 'vico-dynamic-v3.0';

// Assets estáticos a cachear en instalación
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.png',
  // CDNs críticos
  'https://cdn.jsdelivr.net/npm/idb@7/build/umd.js'
];

// Límite de entradas en caché dinámico
const DYNAMIC_CACHE_LIMIT = 50;

// ============================================================
// INSTALACIÓN — Cachear assets estáticos
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Instalando VICO ACTIVE v3.0...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cacheando assets estáticos');
        // Cachear uno a uno para no fallar si alguno no existe
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn(`[SW] No se pudo cachear: ${url}`, err)
            )
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVACIÓN — Limpiar cachés antiguos
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activando nueva versión...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log(`[SW] Eliminando caché antiguo: ${key}`);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — Estrategia Cache First con fallback a red
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests no-GET y extensiones de Chrome
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Para APIs externas (Google, YouTube, etc.) — Network First
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('youtube.com') ||
    url.hostname.includes('api.groq.com') ||
    url.hostname.includes('generativelanguage.googleapis.com') ||
    url.hostname.includes('openrouter.ai')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Para assets estáticos — Cache First
  event.respondWith(cacheFirst(request));
});

// ============================================================
// Estrategia: Cache First
// ============================================================
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      await limitCacheSize(DYNAMIC_CACHE, DYNAMIC_CACHE_LIMIT);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Fallback offline
    const fallback = await caches.match('/index.html');
    return fallback || new Response(
      '<h1>Sin conexión</h1><p>VICO ACTIVE funciona offline. Recarga cuando tengas conexión.</p>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

// ============================================================
// Estrategia: Network First
// ============================================================
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || new Response(
      JSON.stringify({ error: 'Sin conexión', offline: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ============================================================
// Limitar tamaño del caché dinámico
// ============================================================
async function limitCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await limitCacheSize(cacheName, maxItems);
  }
}

// ============================================================
// SYNC — Sincronización en segundo plano
// ============================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-backup') {
    console.log('[SW] Sincronización de backup en segundo plano');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Notificar a todos los clientes que hagan el sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'BACKGROUND_SYNC', tag: 'sync-backup' });
  });
}

// ============================================================
// PUSH — Notificaciones push
// ============================================================
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'VICO ACTIVE';
  const options = {
    body: data.body || 'Tienes una nueva notificación',
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [200, 100, 200],
    data: data.url || '/',
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'close', title: 'Cerrar' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ============================================================
// NOTIFICATION CLICK — Manejar clic en notificación
// ============================================================
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow(event.notification.data || '/')
    );
  }
});

// ============================================================
// MESSAGE — Comunicación con la app principal
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
