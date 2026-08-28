// Service worker do Controle da Moto.
//
// O app é usado na rua, muitas vezes sem sinal (subsolo de garagem, posto
// com sinal fraco). Por isso a estratégia aqui é CACHE PRIMEIRO para o
// "esqueleto" do app: ele abre na hora, mesmo sem internet, e a atualização
// vem em segundo plano para a próxima abertura.
//
// Os dados (registros e fotos) NÃO passam por aqui: ficam no IndexedDB,
// gerenciados pelo app.js, que cuida da fila de envio para a planilha.
//
// Como o app não tem login, abrir sem sinal já cai direto na tela de
// trabalho: o esqueleto vem daqui e os dados vêm do IndexedDB.

const CACHE = 'moto-v3';
const ASSETS = [
  './',
  './index.html',
  './assets/style.css',
  './assets/app.js',
  './assets/calc.js',
  './assets/qr.js',
  './etiquetas.html',
  './assets/logo.svg',
  './manifest.json',
  './icons/icon-192.png?v=1',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Só mexemos no que é do próprio site. O script de login do Google e a
  // chamada ao Apps Script passam direto.
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const rede = fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);

      // Cache primeiro (abre instantâneo, funciona offline); a rede
      // atualiza o cache por trás para a próxima abertura.
      return cached || rede;
    })
  );
});

// Quando o aparelho recupera a conexão, o navegador acorda o service
// worker e avisa as abas abertas para esvaziarem a fila de envio.
self.addEventListener('sync', (e) => {
  if (e.tag !== 'moto-sync') return;
  e.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      clients.forEach((c) => c.postMessage({ type: 'sync' }));
    })
  );
});
