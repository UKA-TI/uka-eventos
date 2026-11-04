// Service worker de EVENTOS UKA. Permite abrir la app sin internet: guarda la
// interfaz, nunca las respuestas de la API. Los datos de recepción se guardan
// aparte en el dispositivo y se borran al cerrar sesión.
const CACHE = 'eventos-uka-v1';
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch('/', { cache: 'no-store' });
      if (response.ok) {
        const html = await response.clone().text();
        await cache.put(SHELL, response);
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)];
        await cache.addAll(assets.map((match) => match[1]));
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// La página avisa qué archivos cargó (fuentes, imágenes) para tenerlos sin internet.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'cache-assets' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches
        .open(CACHE)
        .then((cache) =>
          Promise.all(
            event.data.urls
              .filter((url) => new URL(url).pathname.startsWith('/assets/'))
              .map((url) => cache.add(url).catch(() => undefined)),
          ),
        ),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    return;
  }
  if (request.mode === 'navigate') {
    // Las páginas se piden primero a la red, para no quedarse con una versión vieja.
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(SHELL, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(SHELL);
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Sus nombres cambian con cada versión, así que se pueden reutilizar sin riesgo.
    event.respondWith(
      (async () => {
        // ignoreVary: el servidor responde con Vary: Origin y los módulos se piden con
        // ese encabezado, así que sin esto nunca coincidirían con lo guardado.
        const cached = await caches.match(request, { ignoreVary: true });
        if (cached) {
          return cached;
        }
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});
