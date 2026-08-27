const CACHE = 'socorro-v1';
const ASSETS = [
  './',
  './index.html',
  './assets/style.css',
  './assets/app.js',
  './assets/logo.svg',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Rede primeiro, cache só como reserva do "esqueleto" do app (pra abrir
// rápido/offline). Os dados dos atendimentos vêm sempre da planilha via
// POST e não são cacheados aqui — exigem conexão.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
