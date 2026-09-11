const CACHE_PREFIX = 'reshare-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const CORE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];
const NETWORK_ONLY_PATHS = new Set([
  '/config.json',
  '/health',
  '/service-worker.js',
  '/signaling',
]);
const LINKED_ASSET_PATTERN = /\b(?:src|href)=["']([^"'#]+)["']/g;

async function cacheLinkedAssets(cache, documentResponse) {
  const html = await documentResponse.text();
  const urls = new Set();
  for (const match of html.matchAll(LINKED_ASSET_PATTERN)) {
    const url = new URL(match[1], self.location.origin);
    if (
      url.origin === self.location.origin &&
      !NETWORK_ONLY_PATHS.has(url.pathname)
    )
      urls.add(url.href);
  }
  await Promise.all(
    [...urls].map(async url => {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) await cache.put(url, response);
    }),
  );
}

async function installShell() {
  const cache = await caches.open(CACHE_NAME);
  const documentResponse = await fetch('/', { cache: 'reload' });
  if (!documentResponse.ok)
    throw new Error('Não foi possível armazenar o shell do ReShare.');
  await Promise.all([
    cache.put('/', documentResponse.clone()),
    cacheLinkedAssets(cache, documentResponse.clone()),
    ...CORE_URLS.slice(1).map(url => cache.add(url)),
  ]);
}

async function refreshDocument(cache, request, response) {
  await Promise.all([
    cache.put(request, response.clone()),
    cacheLinkedAssets(cache, response),
  ]);
}

async function cachedResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === 'navigate') {
    const shell = await cache.match('/');
    if (shell) return shell;
  }
  return new Response('Recurso indisponível offline.\n', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

async function updateCache(request, networkResult) {
  try {
    const response = (await networkResult).cache;
    if (!response.ok || response.type !== 'basic') return;
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate')
      await refreshDocument(cache, request, response);
    else await cache.put(request, response);
  } catch {
    // A resposta offline é resolvida separadamente a partir do cache existente.
  }
}

self.addEventListener('install', event => {
  event.waitUntil(installShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(names =>
        Promise.all(
          names
            .filter(
              name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
            )
            .map(name => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    NETWORK_ONLY_PATHS.has(url.pathname)
  )
    return;
  const networkResult = fetch(event.request).then(response => ({
    client: response,
    cache: response.clone(),
  }));
  event.respondWith(
    networkResult
      .then(result => result.client)
      .catch(() => cachedResponse(event.request)),
  );
  event.waitUntil(updateCache(event.request, networkResult));
});
