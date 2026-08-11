/* Service worker: офлайн-режим.
 *
 * Стратегія навмисно проста і передбачувана:
 *   — усі файли застосунку кладемо в кеш під час встановлення;
 *   — далі віддаємо з кешу (миттєво і без мережі), а мережу питаємо у фоні,
 *     щоб наступний запуск був уже оновлений;
 *   — переходи по сторінках завжди повертають index.html, бо маршрути живуть
 *     у хеші й окремих файлів під них не існує.
 *
 * ВАЖЛИВО: піднімай VERSION при кожній зміні файлів застосунку — інакше
 * пристрій продовжить показувати стару версію з кешу.
 */

const VERSION = '1.1.0';
const CACHE_NAME = `dreamcut-ops-v${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles/app.css',
  'src/app.js',
  'src/app-meta.js',

  'src/core/id.js',
  'src/core/storage.js',
  'src/core/models.js',
  'src/core/store.js',
  'src/core/dates.js',
  'src/core/locale.js',
  'src/core/selectors.js',
  'src/core/backup.js',

  'src/core/cine/sensors.js',
  'src/core/cine/optics.js',
  'src/core/cine/exposure.js',
  'src/core/cine/media.js',
  'src/core/cine/timecode.js',
  'src/core/cine/sun.js',

  'src/ui/dom.js',
  'src/ui/sheet.js',
  'src/ui/router.js',
  'src/ui/components.js',
  'src/ui/editors.js',
  'src/ui/reminders.js',

  'src/ui/views/overview.js',
  'src/ui/views/projects.js',
  'src/ui/views/tasks.js',
  'src/ui/views/ideas.js',
  'src/ui/views/calc.js',
  'src/ui/views/settings.js',

  'assets/icons/icon-180.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll падає цілком, якщо бодай один файл недоступний, тому кладемо
      // поштучно: краще частковий кеш, ніж жодного.
      Promise.all(
        ASSETS.map((asset) =>
          cache.add(asset).catch((error) => console.warn('Не закешовано:', asset, error)),
        ),
      ),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Чужі домени не наша справа — застосунок і так нікуди не ходить.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cachePut(request, response.clone());
          return response;
        })
        .catch(() => caches.match('index.html').then((cached) => cached ?? caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cachePut(request, response.clone());
          return response;
        })
        .catch(() => cached);

      // Є в кеші — віддаємо миттєво, оновлення підтягнеться у фоні.
      return cached ?? network;
    }),
  );
});

function cachePut(request, response) {
  caches.open(CACHE_NAME).then((cache) => cache.put(request, response)).catch(() => {});
}

// Дозволяє застосунку попросити негайне оновлення.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
