/**
 * The home screen: the splits you train, and the lifts you have asked to
 * keep an eye on.
 *
 * Splits are not configured here — they are whatever you have been writing.
 * The summary exists for the opposite reason: when a split changes, the key
 * lifts inside it can quietly disappear, and this is what notices.
 */

import { heaviestSet, suggestNames, type HistoryEntry } from '../core/history';
import { isoToday } from '../core/serialize';
import { parsePage } from '../core/parse';
import { normalizeName } from '../core/normalize';
import type { Template } from '../core/types';
import { friendlyDate } from './format';
import * as store from './store';
import { backupNudge, backupPanel, samplesBanner } from './panels';
import { dailyHeadline, dailySection } from './daily-view';

/** A starred lift untouched for this long is worth pointing at. */
const STALE_DAYS = 14;

export function renderHome(root: HTMLElement): void {
  root.replaceChildren();

  if (!store.isDurable()) {
    root.append(warning('This browser will not let the app save. Anything written here disappears when it closes.'));
  }

  const nudge = backupNudge();
  if (nudge) root.append(nudge);

  const samples = samplesBanner();
  if (samples) root.append(samples);

  root.append(exerciseSearch());

  const today = isoToday();
  const inProgress = store.sessions().filter((s) => s.date === today);

  for (const session of inProgress) {
    const page = parsePage(session.text);
    if (!page.title) continue;
    root.append(resumeCard(page.title));
  }

  root.append(sectionTitle('Splits'));

  const templates = store.getTemplates();
  if (templates.length === 0) {
    root.append(note('No splits yet. Start one and it will appear here.'));
  } else {
    const list = document.createElement('ul');
    list.className = 'split-list';
    for (const template of templates) list.append(splitRow(template));
    root.append(list);
  }

  root.append(newSplitForm());

  const headline = dailyHeadline(today);
  root.append(sectionTitle(headline ? `Daily \u00b7 ${headline}` : 'Daily'));
  root.append(dailySection(today));

  root.append(sectionTitle('Key lifts'));
  root.append(summaryCard());

  root.append(backupPanel());
}

/**
 * Finding one lift without going through the split that contains it.
 *
 * This is what the log tab's search did, and it is the only part of it that
 * the calendar does not cover.
 */
function exerciseSearch(): HTMLElement {
  const wrap = document.createElement('div');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'search';
  input.placeholder = 'Find an exercise';
  input.autocapitalize = 'none';
  input.setAttribute('aria-label', 'Find an exercise');

  const results = document.createElement('ul');
  results.className = 'name-list';

  input.addEventListener('input', () => {
    results.replaceChildren();
    const query = input.value.trim();
    if (!query) return;

    const history = store.getHistory();
    const names = suggestNames(history, query, 8);

    if (names.length === 0) {
      results.append(note(`Nothing logged for “${query}” yet.`));
      return;
    }

    for (const name of names) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'name-link chip-link';
      link.href = `#/exercise/${encodeURIComponent(normalizeName(name))}`;
      link.textContent = name;
      row.append(link);
      results.append(row);
    }
  });

  wrap.append(input, results);
  return wrap;
}

function warning(text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'banner banner-warn';
  const span = document.createElement('span');
  span.textContent = text;
  element.append(span);
  return element;
}

function resumeCard(title: string): HTMLElement {
  const link = document.createElement('a');
  link.className = 'resume';
  // Back to the grid, which is where today's column is being written.
  link.href = `#/t/${encodeURIComponent(normalizeName(title))}`;

  const label = document.createElement('span');
  label.className = 'resume-label';
  label.textContent = 'Today';

  const name = document.createElement('span');
  name.className = 'resume-name';
  name.textContent = title;

  link.append(label, name);
  return link;
}

function splitRow(template: Template): HTMLLIElement {
  const row = document.createElement('li');

  const link = document.createElement('a');
  link.className = 'split-link';
  link.href = `#/t/${encodeURIComponent(template.key)}`;

  const name = document.createElement('span');
  name.className = 'split-name';
  name.textContent = template.name;

  const when = document.createElement('span');
  when.className = 'split-last';
  when.textContent = template.lastDate ? friendlyDate(template.lastDate) : 'new';

  const exercises = document.createElement('span');
  exercises.className = 'split-exercises';
  exercises.textContent = template.exercises.length
    ? template.exercises.map((e) => e.name).join(' · ')
    : 'no exercises yet';

  link.append(name, when, exercises);
  row.append(link);
  return row;
}

function newSplitForm(): HTMLElement {
  const form = document.createElement('form');
  form.className = 'add-exercise';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search';
  input.placeholder = 'New split, e.g. Legs';
  input.autocapitalize = 'words';
  input.setAttribute('aria-label', 'New split');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-ghost';
  submit.textContent = 'Add';
  submit.setAttribute('aria-label', 'Add split');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;

    store.startTemplateSession(name);
    input.value = '';
    location.hash = `#/t/${encodeURIComponent(normalizeName(name))}`;
  });

  form.append(input, submit);
  return form;
}

function summaryCard(): HTMLElement {
  const starred = store.starredKeys();

  if (starred.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'summary-empty';
    empty.append(note('Star the lifts you want to keep across any change of split, and they gather here.'));

    const link = document.createElement('a');
    link.className = 'btn btn-ghost';
    link.href = '#/summary';
    link.textContent = 'Choose lifts';
    empty.append(link);
    return empty;
  }

  const list = document.createElement('ul');
  list.className = 'summary-list';

  const history = store.getHistory();
  for (const key of starred) {
    const entries = history.byExercise.get(key) ?? [];
    list.append(summaryRow(key, history.displayNames.get(key) ?? key, entries));
  }

  const more = document.createElement('a');
  more.className = 'btn btn-ghost';
  more.href = '#/summary';
  more.textContent = 'Edit key lifts';

  const wrap = document.createElement('div');
  wrap.append(list, more);
  return wrap;
}

function summaryRow(key: string, name: string, entries: HistoryEntry[]): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'summary-row';

  const link = document.createElement('a');
  link.className = 'summary-link';
  link.href = `#/exercise/${encodeURIComponent(key)}`;

  const title = document.createElement('span');
  title.className = 'summary-name';
  title.textContent = name;

  const last = entries[0];
  const when = document.createElement('span');
  when.className = 'summary-when';
  when.textContent = last ? friendlyDate(last.date) : 'never';

  const sets = document.createElement('span');
  sets.className = 'summary-sets';
  sets.textContent = last ? last.lines.join('   ') : 'not logged yet';

  link.append(title, when, sets);
  row.append(link);

  const best = entries.length ? heaviestSet(entries) : null;
  if (best) {
    const note = document.createElement('span');
    note.className = 'summary-best';
    note.textContent = `best ${best.weight}x${best.reps}`;
    link.append(note);
  }

  const stale = staleDays(last?.date);
  if (stale !== null && stale >= STALE_DAYS) {
    const warn = document.createElement('span');
    warn.className = 'summary-stale';
    warn.textContent = `${stale} days since you did this`;
    row.append(warn);
  }

  return row;
}

function staleDays(iso?: string): number | null {
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const then = new Date(year, month - 1, day).getTime();
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((midnight - then) / 86400000);
}

/** The full list, for choosing which lifts are worth watching. */
export function renderSummary(root: HTMLElement): void {
  root.replaceChildren();

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = 'Key lifts';
  root.append(heading);

  root.append(note('Starred lifts show on the home screen with the last time you did them, and say so when they have gone stale.'));

  const history = store.getHistory();
  const names = [...history.displayNames].sort((a, b) => a[1].localeCompare(b[1]));

  if (names.length === 0) {
    root.append(note('Nothing logged yet.'));
    return;
  }

  const list = document.createElement('ul');
  list.className = 'star-list';

  for (const [key, name] of names) {
    const row = document.createElement('li');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = store.isStarred(key) ? 'star star-on' : 'star';
    toggle.textContent = store.isStarred(key) ? '★' : '☆';
    toggle.setAttribute('aria-label', store.isStarred(key) ? `Unstar ${name}` : `Star ${name}`);
    toggle.setAttribute('aria-pressed', String(store.isStarred(key)));
    toggle.addEventListener('click', () => {
      store.toggleStar(key);
      renderSummary(root);
    });

    const label = document.createElement('a');
    label.className = 'star-name';
    label.href = `#/exercise/${encodeURIComponent(key)}`;
    label.textContent = name;

    const last = (history.byExercise.get(key) ?? [])[0];
    const when = document.createElement('span');
    when.className = 'star-when';
    when.textContent = last ? friendlyDate(last.date) : '';

    row.append(toggle, label, when);
    list.append(row);
  }

  root.append(list);
}

function sectionTitle(text: string): HTMLElement {
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = text;
  return title;
}

function note(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'note';
  element.textContent = text;
  return element;
}
