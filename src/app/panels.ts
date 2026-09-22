/**
 * The pieces that used to live at the bottom of the Log tab.
 *
 * With the log folded into Home and the calendar, backing up and clearing
 * the sample pages still need somewhere to be, and both belong wherever the
 * user is already standing rather than behind a tab of their own.
 */

import { backupNow, restoreFrom } from './backup';
import { friendlyDate } from './format';
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
    warning.textContent = 'This erases every page, split and tracked day on this phone. It cannot be undone.';

    const erase = action('Erase everything', () => {
      store.clearEverything();
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
