/**
 * The pieces that used to live at the bottom of the Log tab.
 *
 * With the log folded into Home and the calendar, backing up and clearing
 * the sample pages still need somewhere to be, and both belong wherever the
 * user is already standing rather than behind a tab of their own.
 */

import { backupNow, restoreFrom } from './backup';
import { friendlyDate } from './format';
import { logOut } from './auth';
import { syncBeforeLeaving, syncNow, syncState } from './sync';
import * as store from './store';

export function banner(text: string, kind: string): HTMLElement {
  const element = document.createElement('div');
  element.className = `banner banner-${kind}`;
  const span = document.createElement('span');
  span.textContent = text;
  element.append(span);
  return element;
}

export function action(text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

export function toast(text: string): void {
  if (!text) return;
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = text;
  document.body.append(element);
  setTimeout(() => element.classList.add('toast-out'), 2600);
  setTimeout(() => element.remove(), 3200);
}

/**
 * The sample history: in while it is wanted, gone in one tap when it is not,
 * and offered again afterwards for anyone who wants to see a full log.
 */
export function samplesBanner(): HTMLElement | null {
  if (store.hasSamples()) {
    const bar = banner('Showing sample history — five sessions of each split and a fortnight of tracking.', 'sample');
    bar.append(action('Clear samples', () => store.clearSamples()));
    return bar;
  }
  return null;
}

/** Offered at the bottom, where it is out of the way of a real log. */
export function sampleOffer(): HTMLElement | null {
  if (store.hasSamples()) return null;

  const bar = document.createElement('p');
  bar.className = 'note';
  bar.textContent = 'Want to see how it reads with history in it? ';
  bar.append(action('Load sample data', () => {
    store.addSamples();
    toast('Sample history loaded. Clear it any time from the banner at the top.');
  }));
  return bar;
}

/** Shown when a week has gone by with real pages written and nothing exported. */
export function backupNudge(): HTMLElement | null {
  if (!store.backupOverdue()) return null;
  const bar = banner('It has been a week since you saved a copy off the phone.', 'nudge');
  bar.append(action('Back up', () => void backupNow().then(toast)));
  return bar;
}

export function backupPanel(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'backup-box';

  const title = document.createElement('h2');
  title.textContent = 'Keep a copy';
  box.append(title);

  const note = document.createElement('p');
  const last = store.lastBackupAt();
  note.textContent = last
    ? `Last saved ${friendlyDate(new Date(last).toISOString().slice(0, 10))}. Share → Save to Files → iCloud Drive.`
    : 'This log only exists on this phone. Share → Save to Files → iCloud Drive.';
  box.append(note);

  const row = document.createElement('div');
  row.className = 'backup-actions';
  row.append(action('Save as text', () => void backupNow('txt').then(toast)));
  row.append(action('Save as JSON', () => void backupNow('json').then(toast)));

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.txt,.json,text/plain,application/json';
  picker.hidden = true;
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (file) void restoreFrom(file).then(toast);
    picker.value = '';
  });
  row.append(action('Restore', () => picker.click()), picker);

  box.append(row);
  if (!store.isEmpty()) box.append(startFresh());
  return box;
}

/**
 * Who this device is signed in as, and the way out.
 *
 * Signing out leaves the log where it is. Somebody on a shared phone would
 * expect it gone, but there is no copy anywhere else yet, so erasing it here
 * would be deleting the only one. "Start fresh" is the deliberate way.
 */
/** When the log last reached the server, in words. */
function asOf(at: number): string {
  if (!at) return 'Not synced yet.';
  const days = Math.round((Date.now() - at) / 86400000);
  return days <= 0
    ? `Synced at ${new Date(at).toLocaleTimeString()}.`
    : `Last synced ${friendlyDate(new Date(at).toISOString().slice(0, 10))}.`;
}

export function accountPanel(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'backup-box account-box';

  const title = document.createElement('h2');
  title.textContent = 'Account';
  box.append(title);

  const who = document.createElement('p');
  const account = store.account();
  who.textContent = account
    ? `Signed in as ${account.handle}.`
    : 'Not signed in.';
  box.append(who);

  const state = syncState();
  const where = document.createElement('p');
  where.className = 'note';
  where.textContent = state.running ? 'Syncing\u2026'
    : state.last === 'offline' ? `Could not reach the server. ${asOf(state.at)}`
      : state.last === 'not-configured' ? 'Syncing is not set up on this copy of the app.'
        : asOf(state.at);
  box.append(where);

  const kept = document.createElement('p');
  kept.className = 'note';
  kept.textContent = 'Signing out leaves this log on the phone. Your account keeps its own copy, '
    + 'so signing in on another device brings it there too.';
  box.append(kept);

  const row = document.createElement('div');
  row.className = 'account-actions';

  // Never disabled while a sync is in flight: nothing redraws this panel
  // when one finishes, so it would sit greyed out until the next render.
  // A second call while busy is harmless and says so.
  row.append(action('Sync now', () => {
    void syncNow().then((result) => {
      toast(result === 'offline' ? 'Could not reach the server. It will try again.'
        : result === 'signed-out' ? 'That session has expired. Sign in again.'
          : result === 'busy' ? 'Already syncing.'
            : result === 'synced' ? 'Synced.'
              : 'Already up to date.');
    });
  }));

  row.append(action('Sign out', () => {
    void logOut().then(() => {
      location.hash = '#/home';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  }));
  box.append(row);

  return box;
}

/**
 * Wiping the device, behind a second tap.
 *
 * A single button next to "Save as text" is too easy to hit by accident for
 * something with no undo, so the first tap only asks, and stops asking on
 * its own if it is ignored.
 */
function startFresh(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'danger-zone';

  const render = (armed: boolean) => {
    wrap.replaceChildren();

    if (!armed) {
      const button = action('Start fresh', () => render(true));
      button.classList.add('btn-danger');
      wrap.append(button);
      return;
    }

    const warning = document.createElement('p');
    warning.className = 'danger-note';
    warning.textContent = 'This erases every page, split and tracked day \u2014 and because your log syncs, '
      + 'it erases them on every device signed in to your account, not just this one. It cannot be undone.';

    const erase = action('Erase everything', () => {
      store.clearEverything();
      syncBeforeLeaving();
      toast('Everything cleared. This is a brand new log.');
    });
    erase.classList.add('btn-danger-on');

    const cancel = action('Keep it', () => render(false));

    const buttons = document.createElement('div');
    buttons.className = 'backup-actions';
    buttons.append(erase, cancel);

    wrap.append(warning, buttons);
    // Do not sit armed indefinitely if it was hit by mistake.
    window.setTimeout(() => {
      if (wrap.contains(erase)) render(false);
    }, 8000);
  };

  render(false);
  return wrap;
}
