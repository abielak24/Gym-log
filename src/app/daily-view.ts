/**
 * The daily tracker: a handful of things counted every day, independent of
 * whatever split you are on.
 *
 * Each day owns its own goals. A new day arrives pre-filled with the last
 * tracked day's goals and empty values, so the common case is typing one
 * number per row, and changing a goal is still just typing over it.
 *
 * Nothing is stored until something is actually filled in — a day left alone
 * stays untracked rather than becoming a row of zeroes.
 */

import { makeEntry, metGoal, progress, summarise, type DailyEntry } from '../core/daily';
import { isoToday } from '../core/serialize';
import { friendlyDate } from './format';
import * as store from './store';

const SAVE_DELAY = 400;

const pending = new Set<() => void>();

export function flushDaily(): void {
  for (const save of [...pending]) save();
}

export function renderDailyPage(root: HTMLElement, date: string): void {
  root.replaceChildren();

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = `Daily · ${friendlyDate(date)}`;
  root.append(heading);

  root.append(dailySection(date));
}

export function dailySection(date: string): HTMLElement {
  const section = document.createElement('div');
  section.className = 'daily';

  const { entries } = store.dailyFor(date);
  // The rows being edited, which only reach the store once one is touched.
  const rows: DailyEntry[] = entries.map((entry) => ({ ...entry }));

  const save = () => {
    pending.delete(save);
    store.saveDaily(date, rows.filter((row) => row.name.trim() !== ''));
  };

  let timer: number | undefined;
  const scheduleSave = () => {
    pending.add(save);
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(save, SAVE_DELAY);
  };

  const list = document.createElement('ul');
  list.className = 'daily-list';

  const redraw = () => {
    list.replaceChildren();
    rows.forEach((row, index) => list.append(dailyRow(row, () => {
      rows.splice(index, 1);
      save();
      redraw();
    }, scheduleSave)));

    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = 'Nothing tracked daily yet. Add pushups, cardio, steps — whatever you count.';
      list.append(empty);
    }
  };

  redraw();
  section.append(list);

  const form = document.createElement('form');
  form.className = 'add-exercise';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search';
  input.placeholder = 'Track something daily';
  input.autocapitalize = 'words';
  input.setAttribute('aria-label', 'Add something to track daily');

  const add = document.createElement('button');
  add.type = 'submit';
  add.className = 'btn btn-ghost';
  add.textContent = 'Add';
  add.setAttribute('aria-label', 'Add daily tracker row');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    rows.push(makeEntry(name));
    input.value = '';
    save();
    redraw();
  });

  form.append(input, add);
  section.append(form);
  return section;
}

function dailyRow(row: DailyEntry, onRemove: () => void, onEdit: () => void): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'daily-row';

  const bar = document.createElement('div');
  bar.className = 'daily-bar';
  const fill = document.createElement('span');
  bar.append(fill);

  const paint = () => {
    const ratio = progress(row);
    const met = metGoal(row);
    fill.style.width = ratio === null ? '0%' : `${Math.min(100, Math.round(ratio * 100))}%`;
    item.classList.toggle('daily-met', met === true);
    item.classList.toggle('daily-unreadable', met === null && row.value.trim() !== '');
  };

  const name = field(row.name, 'Name', 'daily-name', (value) => {
    row.name = value;
    row.key = makeEntry(value).key;
    onEdit();
  });

  const value = field(row.value, `${row.name} today`, 'daily-value', (text) => {
    row.value = text;
    paint();
    onEdit();
  });

  const slash = document.createElement('span');
  slash.className = 'daily-slash';
  slash.textContent = '/';

  const goal = field(row.goal, `${row.name} goal`, 'daily-goal', (text) => {
    row.goal = text;
    paint();
    onEdit();
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-ghost btn-icon';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Stop tracking ${row.name}`);
  remove.addEventListener('click', onRemove);

  const top = document.createElement('div');
  top.className = 'daily-top';
  top.append(name, value, slash, goal, remove);

  item.append(top, bar);
  paint();
  return item;
}

function field(initial: string, label: string, className: string, onInput: (value: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.value = initial;
  input.setAttribute('aria-label', label);
  input.autocapitalize = className === 'daily-name' ? 'words' : 'none';
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

/** One line for the home screen: how today is going. */
export function dailyHeadline(date = isoToday()): string {
  const { entries, seeded } = store.dailyFor(date);
  if (entries.length === 0) return '';
  if (seeded) return 'not filled in yet';

  const { tracked, met } = summarise(entries);
  if (tracked === 0) return 'not filled in yet';
  return `${met} of ${tracked} met`;
}
