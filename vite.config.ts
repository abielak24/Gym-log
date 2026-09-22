import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

/**
 * Precache the built files so the app opens in a gym with no signal.
 *
 * Small enough to write by hand: the plugin lists what the build produced and
 * stamps a cache name from its contents, so a new version replaces the old
 * one instead of being shadowed by it.
 */
function serviceWorker(): Plugin {
  return {
    name: 'gym-notebook-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
      const hash = createHash('sha256');

      for (const [fileName, chunk] of Object.entries(bundle)) {
        assets.push(fileName);
        const contents = chunk.type === 'chunk' ? chunk.code : chunk.source;
        hash.update(typeof contents === 'string' ? contents : Buffer.from(contents));
      }

      const version = hash.digest('hex').slice(0, 12);
      const unique = [...new Set(assets)].filter((name) => name !== 'sw.js');

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const CACHE = 'gym-notebook-${version}';
const ASSETS = ${JSON.stringify(unique)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((path) => new URL(path, self.location).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Any route renders from the one page; hash routing does the rest.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(new URL('index.html', self.location).href).then((hit) => hit || fetch(request)),
    );
    return;
  }

  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`,
      });
    },
  };
}

export default defineConfig({
  // Relative, so the same build works at a domain root or under /gym-notebook/.
  base: './',
  plugins: [serviceWorker()],
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
