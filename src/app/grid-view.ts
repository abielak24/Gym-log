/**
 * A split, drawn the way the notebook draws it: exercises down the left,
 * one dated column per session, oldest to newest.
 *
 * The grid opens scrolled to its right-hand end, so today's column and the
 * one before it are what you see — the comparison that actually matters —
 * while older sessions stay a swipe away rather than a page flip.
 *
 * Only today's column can be typed into. Each cell writes its lines straight
 * back into that session's page text, so the notebook, the export and the
 * grid never disagree about what happened.
 */

import { buildGrid } from '../core/grid';
import { lastTime } from '../core/history';
import { normalizeName } from '../core/normalize';
import { addExercise } from '../core/edit';
import type { Template } from '../core/types';
import { friendlyDate } from './format';
import * as store from './store';
import { isoToday } from '../core/serialize';

const SAVE_DELAY = 400;

export function renderTemplate(root: HTMLElement, key: string): void {
  const template = store.getTemplate(key);
  root.replaceChildren();

  if (!template) {
    const missing = document.createElement('p');
    missing.className = 'empty';
    missing.textContent = 'That split has nothing in it yet.';
    root.append(missing);
    return;
  }

  const today = isoToday();
  const todaySession = store.sessions().find((s) => s.date === today && template.sessionIds.includes(s.id));

  root.append(header(template, todaySession?.id));
  root.append(grid(template, todaySession?.id));

  if (!todaySession) {
    root.append(startButton(template));
  } else {
    root.append(addExerciseRow(template, todaySession.id));
  }
}

function header(template: Template, todayId?: string): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'split-head';

  const title = document.createElement('h1');
  title.textContent = template.name;

  const when = document.createElement('p');
  when.className = 'split-when';
  when.textContent = todayId
    ? 'writing today'
    : template.lastDate
      ? `last done ${friendlyDate(template.lastDate)}`
      : 'nothing logged yet';

  const edit = document.createElement('a');
  edit.className = 'btn btn-ghost';
  edit.href = `#/edit/${encodeURIComponent(template.key)}`;
  edit.textContent = 'Edit split';

  const text = document.createElement('div');
  text.append(title, when);
  bar.append(text, edit);
  return bar;
}

function grid(template: Template, editableId?: string): HTMLElement {
  const data = buildGrid(template, store.sessions(), { editableSessionId: editableId });

  const scroller = document.createElement('div');
  scroller.className = 'grid-scroll';

  const table = document.createElement('div');
  table.className = 'grid';
  table.style.setProperty('--columns', String(data.columns.length));

  const corner = document.createElement('div');
  corner.className = 'grid-corner';
  table.append(corner);

  for (const column of data.columns) {
    const head = document.createElement('div');
    head.className = `grid-date${column.editable ? ' grid-date-today' : ''}`;
    head.textContent = shortDate(column.date);
    table.append(head);
  }

  const editableIndex = data.columns.findIndex((c) => c.editable);

  for (const row of data.rows) {
    const name = document.createElement('a');
    name.className = 'grid-name';
    name.href = `#/exercise/${encodeURIComponent(row.key)}`;
    name.textContent = row.name;
    table.append(name);

    row.cells.forEach((lines, index) => {
      const column = data.columns[index];
      if (column.editable) {
        // The column before this one is what the placeholder offers, so an
        // empty cell shows last time's sets without pretending they are typed.
        const previous = index > 0 ? row.cells[index - 1] : ghostFromHistory(row.name, column.sessionId);
        table.append(editableCell(column.sessionId, row.name, lines, previous));
      } else {
        table.append(readOnlyCell(lines, index === editableIndex - 1));
      }
    });
  }

  scroller.append(table);
  // Land on the newest sessions rather than the oldest.
  requestAnimationFrame(() => {
    scroller.scrollLeft = scroller.scrollWidth;
  });
  return scroller;
}

function ghostFromHistory(name: string, excludeSessionId: string): string[] {
  return lastTime(store.getHistory(), name, excludeSessionId)?.lines ?? [];
}

function readOnlyCell(lines: string[], isPrevious: boolean): HTMLElement {
  const cell = document.createElement('pre');
  cell.className = `grid-cell${isPrevious ? ' grid-cell-previous' : ''}`;
  cell.textContent = lines.join('\n');
  return cell;
}

function editableCell(sessionId: string, exercise: string, lines: string[], previous: string[]): HTMLElement {
  const cell = document.createElement('textarea');
  cell.className = 'grid-cell grid-cell-today';
  cell.value = lines.join('\n');
  cell.placeholder = previous.join('\n');
  cell.rows = 1;
  cell.spellcheck = false;
  cell.autocapitalize = 'none';
  cell.setAttribute('aria-label', exercise);
  cell.setAttribute('data-exercise', exercise);

  let timer: number | undefined;

  const resize = () => {
    cell.style.height = 'auto';
    cell.style.height = `${cell.scrollHeight}px`;
  };

  const save = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    store.saveCell(sessionId, exercise, cell.value.split('\n'));
  };

  cell.addEventListener('input', () => {
    resize();
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(save, SAVE_DELAY);
  });
  cell.addEventListener('blur', save);

  requestAnimationFrame(resize);
  return cell;
}

function startButton(template: Template): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'start-row';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-wide';
  button.textContent = `Log today’s ${template.name}`;
  button.addEventListener('click', () => {
    store.startTemplateSession(template.name);
    renderTemplate(wrap.parentElement as HTMLElement, template.key);
  });

  wrap.append(button);
  return wrap;
}

/**
 * Adding an exercise that is not in the split.
 *
 * It goes into today's page, which is all it takes: the split is read back
 * out of recent pages, so it will be part of this split from now on.
 */
function addExerciseRow(template: Template, sessionId: string): HTMLElement {
  const wrap = document.createElement('form');
  wrap.className = 'add-exercise';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search';
  input.placeholder = 'Add an exercise';
  input.autocapitalize = 'words';
  input.setAttribute('list', 'known-exercises');

  const known = document.createElement('datalist');
  known.id = 'known-exercises';
  for (const name of store.getHistory().displayNames.values()) {
    const option = document.createElement('option');
    option.value = name;
    known.append(option);
  }

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-ghost';
  submit.textContent = 'Add';

  wrap.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;

    const session = store.session(sessionId);
    if (!session) return;

    store.saveText(sessionId, addExercise(session.text, name), null);
    // An exercise hidden from this split earlier is plainly wanted again.
    const override = store.overrideFor(template.key);
    if (override?.hidden?.includes(normalizeName(name))) {
      store.saveOverride(template.key, { hidden: override.hidden.filter((k) => k !== normalizeName(name)) });
    }
    input.value = '';
    renderTemplate(wrap.parentElement as HTMLElement, template.key);
  });

  wrap.append(input, known, submit);
  return wrap;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${month}/${day}`;
}
