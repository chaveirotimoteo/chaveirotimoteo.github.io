const CACHE = 'precos-v2';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './assets/style.css',
  './assets/app.js',
  './assets/admin.js',
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

// Rede primeiro, cache só como reserva (offline ou falha de rede). Assim,
// toda vez que o site é atualizado, quem já instalou o atalho recebe a
// versão nova automaticamente na próxima abertura, sem precisar refazer nada.
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
