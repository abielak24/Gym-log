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

/** Shown while the seeded example pages are still there. */
export function samplesBanner(): HTMLElement | null {
  if (!store.hasSamples()) return null;
  const bar = banner('Two sample pages from a notebook, so a new split has something to prefill from.', 'sample');
  bar.append(action('Clear samples', () => store.clearSamples()));
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
  return box;
}
