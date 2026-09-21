// Service worker DYNOZ PLAYLIST.
// Tugas dia: benarkan app dipasang (PWA), dan buka laju walaupun internet perlahan.
// Data playlist TIDAK di-cache — dia sentiasa diambil terus dari server supaya tak basi.

const VERSION = 'dynoz-v1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/platforms.js',
  './js/store.js',
  './js/seed.js',
  './js/player.js',
  './icon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL).catch(() => {}); // kalau satu fail gagal, jangan batalkan pemasangan
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // YouTube, Spotify, gambar cover: biar browser uruskan
  if (url.pathname.startsWith('/api/')) return; // data & carian: sentiasa dari server

  // Ambil dari internet dulu (supaya sentiasa versi terbaru), guna salinan bila talian putus
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(VERSION);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(request, { ignoreSearch: true });
      return cached ?? (await caches.match('./index.html')) ?? Response.error();
    }
  })());
});
