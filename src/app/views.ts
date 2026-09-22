/**
 * Three screens: the page you are writing, the pages you have written, and
 * everything you have ever done for one lift.
 */

import { heaviestSet, pageVolume, suggestNames } from '../core/history';
import { normalizeName } from '../core/normalize';
import { parsePage } from '../core/parse';
import type { Session } from '../core/types';
import { createEditor, type EditorHandle } from './editor';
import { friendlyDate, thousands } from './format';
import * as store from './store';
import { backupNow, restoreFrom } from './backup';

let openEditor: EditorHandle | null = null;

export function teardown(): void {
  // Clear the reference first: destroying an editor saves it, which notifies
  // the store, which can re-run the route and land back in here.
  const closing = openEditor;
  openEditor = null;
  closing?.destroy();
}

export function renderToday(root: HTMLElement): void {
  const session = store.startToday();
  store.pruneEmpty(session.id);
  renderPageEditor(root, session, { heading: 'Today', focus: true });
}

export function renderPage(root: HTMLElement, id: string): void {
  const session = store.session(id);
  if (!session) {
    root.replaceChildren(message('That page is gone.'));
    return;
  }
  renderPageEditor(root, session, { heading: friendlyDate(session.date), focus: false });
}

function renderPageEditor(root: HTMLElement, session: Session, options: { heading: string; focus: boolean }): void {
  root.replaceChildren();

  if (!store.isDurable()) {
    root.append(banner('This browser will not let the app save. Anything you write here disappears when you close it.', 'warn'));
  }

  if (store.backupOverdue()) {
    const bar = banner('It has been a week since you saved a copy off the phone.', 'nudge');
    bar.append(action('Back up', () => void backupNow().then(toast)));
    root.append(bar);
  }

  const editor = createEditor(session.id, session.text);
  openEditor = editor;
  root.append(editor.element);

  if (options.focus) {
    // Wait for layout, or the textarea measures its own height as zero.
    requestAnimationFrame(() => editor.focus());
  }
}

export function renderLog(root: HTMLElement): void {
  root.replaceChildren();

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'search';
  search.placeholder = 'Search exercises';
  search.autocapitalize = 'none';
  root.append(search);

  const results = document.createElement('div');
  root.append(results);

  const draw = () => {
    results.replaceChildren();
    const query = search.value.trim();

    if (query) {
      const names = suggestNames(store.getHistory(), query, 8);
      if (names.length === 0) {
        results.append(message(`Nothing logged for "${query}" yet.`));
        return;
      }
      const list = document.createElement('ul');
      list.className = 'name-list';
      for (const name of names) list.append(exerciseLink(name));
      results.append(list);
      return;
    }

    if (store.hasSamples()) {
      const bar = banner('Two sample pages from a notebook, so today has something to prefill from.', 'sample');
      bar.append(action('Clear samples', () => store.clearSamples()));
      results.append(bar);
    }

    const sessions = store.sessions();
    if (sessions.length === 0) {
      results.append(message('No pages yet. Write today’s.'));
      return;
    }

    const list = document.createElement('ul');
    list.className = 'log-list';
    for (const session of sessions) list.append(logRow(session));
    results.append(list);

    results.append(backupControls());
  };

  search.addEventListener('input', draw);
  draw();
}

function logRow(session: Session): HTMLLIElement {
  const page = parsePage(session.text);
  const { sets, volume } = pageVolume(page);

  const row = document.createElement('li');
  row.className = 'log-row';

  const link = document.createElement('a');
  link.href = `#/page/${encodeURIComponent(session.id)}`;
  link.className = 'log-link';

  const title = document.createElement('span');
  title.className = 'log-title';
  title.textContent = page.title || 'Untitled';

  const when = document.createElement('span');
  when.className = 'log-when';
  when.textContent = friendlyDate(session.date);

  const summary = document.createElement('span');
  summary.className = 'log-summary';
  summary.textContent = sets === 0
    ? 'nothing written'
    : `${sets} set${sets === 1 ? '' : 's'}${volume > 0 ? ` · ${thousands(volume)} lb` : ''}`;

  link.append(title, when, summary);
  row.append(link);

  if (page.exercises.length > 0) {
    const names = document.createElement('div');
    names.className = 'log-exercises';
    for (const block of page.exercises) {
      if (block.sets.length === 0) continue;
      names.append(exerciseChip(block.name));
    }
    row.append(names);
  }

  if (session.sample) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'sample';
    link.append(tag);
  }

  return row;
}

function exerciseChip(name: string): HTMLAnchorElement {
  const chip = document.createElement('a');
  chip.className = 'chip-link';
  chip.href = `#/exercise/${encodeURIComponent(normalizeName(name))}`;
  chip.textContent = name;
  return chip;
}

function exerciseLink(name: string): HTMLLIElement {
  const row = document.createElement('li');
  const link = exerciseChip(name);
  link.className = 'name-link';
  row.append(link);
  return row;
}

export function renderExercise(root: HTMLElement, key: string): void {
  root.replaceChildren();

  const history = store.getHistory();
  const entries = history.byExercise.get(key) ?? [];
  const name = history.displayNames.get(key) ?? key;

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = name;
  root.append(heading);

  if (entries.length === 0) {
    root.append(message('Nothing logged for this one.'));
    return;
  }

  const best = heaviestSet(entries);
  const summary = document.createElement('p');
  summary.className = 'exercise-summary';
  summary.textContent = best
    ? `${entries.length} session${entries.length === 1 ? '' : 's'} · heaviest ${best.weight}x${best.reps}, ${friendlyDate(best.date)}`
    : `${entries.length} session${entries.length === 1 ? '' : 's'}`;
  root.append(summary);

  const list = document.createElement('ul');
  list.className = 'history-list';

  for (const entry of entries) {
    const row = document.createElement('li');

    const when = document.createElement('a');
    when.className = 'history-when';
    when.href = `#/page/${encodeURIComponent(entry.sessionId)}`;
    when.textContent = `${friendlyDate(entry.date)} · ${entry.title}`;

    const sets = document.createElement('pre');
    sets.className = 'history-sets';
    sets.textContent = entry.lines.join('\n');

    row.append(when, sets);
    list.append(row);
  }

  root.append(list);
}

function backupControls(): HTMLElement {
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

function banner(text: string, kind: string): HTMLElement {
  const element = document.createElement('div');
  element.className = `banner banner-${kind}`;
  const span = document.createElement('span');
  span.textContent = text;
  element.append(span);
  return element;
}

function action(text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost';
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function message(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'empty';
  element.textContent = text;
  return element;
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
