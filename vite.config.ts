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
      .then(() => self.skipWaiting())
      // addAll is all-or-nothing, but caches.open has already made the cache.
      // Leaving a half-filled one behind under this version's name means the
      // next install finds it, believes it, and serves a page whose script is
      // not in it - which is a blank screen with no way back.
      .catch((error) => caches.delete(CACHE).then(() => { throw error; })),
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
    const page = new URL('index.html', self.location).href;
    event.respondWith(
      caches.match(page).then((hit) => {
        // Serve the copy at once - opening in a basement is the whole point -
        // and fetch a fresh one behind it, so the next open is current even if
        // the update dance does not happen for some reason.
        if (hit) {
          event.waitUntil(
            fetch(request)
              .then((fresh) => (fresh.ok ? caches.open(CACHE).then((cache) => cache.put(page, fresh)) : null))
              .catch(() => null),
          );
          return hit;
        }
        return fetch(request);
      }),
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
