// Service Worker - PWA离线支持
const CACHE_NAME = 'inventory-cache-v17';
const CACHE_URLS = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/js/modules/api.js',
  '/js/modules/config.js',
  '/js/modules/barcode.js',
  '/js/modules/camera.js',
  '/js/modules/chart.js',
  '/js/modules/products.js',
  '/js/modules/transactions.js',
  '/js/modules/inventory.js',
  '/manifest.json'
];

// 安装时缓存核心资源
self.addEventListener('install', (event) => {
  self.skipWaiting(); // 新版本立即接管，不让用户一直跑旧 SW
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_URLS);
    })
  );
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 网络优先，缓存作为后备
self.addEventListener('fetch', (event) => {
  // 只处理GET请求
  if (event.request.method !== 'GET') return;

  // API请求 - 网络优先
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // 静态资源：HTML/JS/CSS 一律「网络优先」——避免改完代码手机上还在跑旧版本
  const url = new URL(event.request.url);
  const isCode = /\.(js|css)$/.test(url.pathname) || event.request.mode === 'navigate';
  if (isCode) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 其他静态资源（图标/清单等） - 缓存优先
  event.respondWith(
    caches.match(event.request).then((cacheResponse) => {
      return cacheResponse || fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
