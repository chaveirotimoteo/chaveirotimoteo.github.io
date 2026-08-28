const CACHE = 'socorro-v2';
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
// POST e não são cacheados aqui — exigem conexão. As fotos também não:
// chegam pela API já autenticada e ficam só na memória da página.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Só mexemos no que é do próprio site. Recursos de outras origens (o
  // script de login do Google, por exemplo) passam direto: a resposta é
  // opaca e guardá-la no cache falharia silenciosamente.
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
