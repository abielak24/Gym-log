/**
 * Wiring: a hash router, a top bar, and the two bits of iOS housekeeping a
 * home-screen app needs — keeping the hint bar above the keyboard, and
 * picking up a new version of itself without a hard refresh.
 */

import './styles.css';
import * as store from './app/store';
import { renderExercise, renderLog, renderPage, renderToday, teardown } from './app/views';

const view = document.getElementById('view') as HTMLElement;
const tabs = [...document.querySelectorAll<HTMLAnchorElement>('.tab')];

function route(): void {
  const hash = location.hash.replace(/^#\/?/, '') || 'today';
  const [screen, rest] = [hash.split('/')[0], hash.split('/').slice(1).join('/')];

  teardown();
  window.scrollTo(0, 0);

  switch (screen) {
    case 'log':
      renderLog(view);
      break;
    case 'page':
      renderPage(view, decodeURIComponent(rest));
      break;
    case 'exercise':
      renderExercise(view, decodeURIComponent(rest));
      break;
    default:
      renderToday(view);
  }

  for (const tab of tabs) {
    const target = tab.getAttribute('href')?.replace(/^#\/?/, '') ?? '';
    tab.classList.toggle('tab-on', target === screen || (screen === 'page' && target === 'log'));
  }
}

/**
 * The on-screen keyboard covers the bottom of the window without resizing it,
 * so the hint bar is positioned against the visual viewport instead.
 */
function trackKeyboard(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const update = () => {
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty('--keyboard-inset', `${covered}px`);
  };

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  // On the very first visit there is no controller yet, and the worker taking
  // over is not a new version — reloading then would be a pointless flash.
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.register(new URL('sw.js', location.href), { scope: './' }).catch(() => {
    // Offline support is a bonus; the app works without it.
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

store.load();
store.pruneEmpty();
store.subscribe(() => {
  // Only the log reflects other screens' edits; the editor owns its own text.
  if (location.hash.startsWith('#/log')) route();
});

window.addEventListener('hashchange', route);
window.addEventListener('pagehide', () => teardown());
trackKeyboard();
registerServiceWorker();
route();
