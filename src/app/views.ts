/**
 * The two screens that sit behind the grid: a day as plain text, and one
 * exercise across every day it was done.
 */

import { heaviestSet } from '../core/history';
import type { Session } from '../core/types';
import { createEditor, type EditorHandle } from './editor';
import { friendlyDate } from './format';
import { backupNudge, banner } from './panels';
import * as store from './store';

let openEditor: EditorHandle | null = null;

export function teardown(): void {
  // Clear the reference first: destroying an editor saves it, which notifies
  // the store, which can re-run the route and land back in here.
  const closing = openEditor;
  openEditor = null;
  closing?.destroy();
}

/** A day as the text it really is, for when the grid is the wrong shape. */
export function renderPage(root: HTMLElement, id: string): void {
  const session = store.session(id);
  if (!session) {
    root.replaceChildren(message('That page is gone.'));
    return;
  }
  store.pruneEmpty(session.id);
  root.replaceChildren();

  if (!store.isDurable()) {
    root.append(banner('This browser will not let the app save. Anything you write here disappears when you close it.', 'warn'));
  }

  const nudge = backupNudge();
  if (nudge) root.append(nudge);

  const editor = createEditor(session.id, session.text);
  openEditor = editor;
  root.append(editor.element);
}

export function renderExercise(root: HTMLElement, key: string): void {
  root.replaceChildren();

  const history = store.getHistory();
  const entries = history.byExercise.get(key) ?? [];
  const name = history.displayNames.get(key) ?? key;

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = name;

  // Starring is how a lift stays visible when the split around it changes.
  const star = document.createElement('button');
  star.type = 'button';
  star.className = store.isStarred(key) ? 'star star-on' : 'star';
  star.textContent = store.isStarred(key) ? '★' : '☆';
  star.setAttribute('aria-label', store.isStarred(key) ? `Unstar ${name}` : `Star ${name}`);
  star.setAttribute('aria-pressed', String(store.isStarred(key)));
  star.addEventListener('click', () => {
    store.toggleStar(key);
    renderExercise(root, key);
  });

  const head = document.createElement('div');
  head.className = 'exercise-head';
  head.append(heading, star);
  root.append(head);

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
    when.href = pageLink(entry.sessionId);
    when.textContent = `${friendlyDate(entry.date)} · ${entry.title}`;

    const sets = document.createElement('pre');
    sets.className = 'history-sets';
    sets.textContent = entry.lines.join('\n');

    row.append(when, sets);
    list.append(row);
  }

  root.append(list);
}

/** A session opens in its split's grid where it has one, else as a page. */
function pageLink(sessionId: string): string {
  const session: Session | undefined = store.session(sessionId);
  if (session) {
    const template = store.getTemplates().find((t) => t.sessionIds.includes(session.id));
    if (template) return `#/t/${encodeURIComponent(template.key)}/${encodeURIComponent(session.id)}`;
  }
  return `#/page/${encodeURIComponent(sessionId)}`;
}

function message(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'empty';
  element.textContent = text;
  return element;
}
