/**
 * Wiring: a hash router, a top bar, and the two bits of iOS housekeeping a
 * home-screen app needs — keeping the hint bar above the keyboard, and
 * picking up a new version of itself without a hard refresh.
 */

import './styles.css';
import * as store from './app/store';
import { renderExercise, renderLog, renderPage, teardown } from './app/views';
import { renderHome, renderSummary } from './app/home-view';
import { renderTemplate } from './app/grid-view';
import { renderEditSplit } from './app/edit-split';

const view = document.getElementById('view') as HTMLElement;
const tabs = [...document.querySelectorAll<HTMLAnchorElement>('.tab')];

function route(): void {
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const [screen, rest] = [hash.split('/')[0], hash.split('/').slice(1).join('/')];

  teardown();
  window.scrollTo(0, 0);

  switch (screen) {
    case 'log':
      renderLog(view);
      break;
    case 't':
      renderTemplate(view, decodeURIComponent(rest));
      break;
    case 'edit':
      renderEditSplit(view, decodeURIComponent(rest));
      break;
    case 'summary':
      renderSummary(view);
      break;
    case 'page':
      renderPage(view, decodeURIComponent(rest));
      break;
    case 'exercise':
      renderExercise(view, decodeURIComponent(rest));
      break;
    default:
      renderHome(view);
  }

  // Everything that hangs off the home screen keeps the Home tab lit.
  const belongsToHome = ['home', 't', 'edit', 'summary', 'exercise', ''];
  for (const tab of tabs) {
    const target = tab.getAttribute('href')?.replace(/^#\/?/, '') || 'home';
    const on = target === screen || (target === 'home' && belongsToHome.includes(screen));
    tab.classList.toggle('tab-on', on);
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
  // Screens that own an input - the page editor, the grid's cells - must not
  // be rebuilt underneath the cursor. The rest can redraw freely.
  if (location.hash.startsWith('#/log')) route();
});

window.addEventListener('hashchange', route);
window.addEventListener('pagehide', () => teardown());
trackKeyboard();
registerServiceWorker();
route();
