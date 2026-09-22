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

import { buildGrid, type GridCell } from '../core/grid';
import { parseSetLine } from '../core/parse';
import { lastTime } from '../core/history';
import { normalizeName } from '../core/normalize';
import { addExercise } from '../core/edit';
import type { Template } from '../core/types';
import { friendlyDate } from './format';
import * as store from './store';
import { isoToday } from '../core/serialize';

const SAVE_DELAY = 400;

/**
 * Cells save a moment after you stop typing. Closing the app inside that
 * moment must not cost the set, so every cell with an unsaved change leaves
 * a way to flush it here, and the page's own teardown calls them.
 */
const pending = new Set<() => void>();

export function flushCells(): void {
  for (const save of [...pending]) save();
}

/**
 * @param editing a session id to open for editing, rather than today's. A
 *   workout logged in a hurry is rarely complete, and finishing it on the bus
 *   home should not mean retyping it as text.
 */
export function renderTemplate(root: HTMLElement, key: string, editing?: string): void {
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

  const open = editing && template.sessionIds.includes(editing) ? editing : todaySession?.id;

  root.append(header(template, open, todaySession?.id));
  root.append(grid(template, root, open));

  if (open) root.append(addExerciseRow(template, open, root));
  else root.append(startButton(template, root));
}

function header(template: Template, openId?: string, todayId?: string): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'split-head';

  const title = document.createElement('h1');
  title.textContent = template.name;

  const when = document.createElement('p');
  when.className = 'split-when';
  const openSession = openId ? store.session(openId) : undefined;
  when.textContent = openId && openId === todayId
    ? 'writing today'
    : openSession
      ? `editing ${friendlyDate(openSession.date)}`
      : template.lastDate
        ? `last done ${friendlyDate(template.lastDate)}`
        : 'nothing logged yet';

  const actions = document.createElement('div');
  actions.className = 'split-actions';

  const edit = document.createElement('a');
  edit.className = 'btn btn-ghost';
  edit.href = `#/edit/${encodeURIComponent(template.key)}`;
  edit.textContent = 'Edit split';
  actions.append(edit);

  // The escape hatch: the day as the text it really is, for the times the
  // grid is the wrong shape for what happened.
  if (openId) {
    const asText = document.createElement('a');
    asText.className = 'btn btn-ghost';
    asText.href = `#/page/${encodeURIComponent(openId)}`;
    asText.textContent = 'As text';
    actions.append(asText);
  }

  const text = document.createElement('div');
  text.append(title, when);
  bar.append(text, actions);
  return bar;
}

function grid(template: Template, root: HTMLElement, editableId?: string): HTMLElement {
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
    // Any past column can be opened for editing, so a session left half
    // written can be finished later without retyping it.
    const head = document.createElement('button');
    head.type = 'button';
    head.className = `grid-date${column.editable ? ' grid-date-open' : ''}`;
    head.textContent = shortDate(column.date);
    head.setAttribute('aria-pressed', String(column.editable));
    head.setAttribute('aria-label', column.editable ? `Editing ${column.date}` : `Edit ${column.date}`);
    if (!column.editable) {
      head.addEventListener('click', () => renderTemplate(root, template.key, column.sessionId));
    }
    table.append(head);
  }

  const editableIndex = data.columns.findIndex((c) => c.editable);

  for (const row of data.rows) {
    const name = document.createElement('a');
    name.className = 'grid-name';
    name.href = `#/exercise/${encodeURIComponent(row.key)}`;
    name.textContent = row.name;
    table.append(name);

    row.cells.forEach((cell, index) => {
      const column = data.columns[index];
      if (column.editable) {
        // The column before this one is what the placeholder offers, so an
        // empty cell shows last time's sets without pretending they are typed.
        const previous = index > 0 ? row.cells[index - 1].lines : ghostFromHistory(row.name, column.sessionId);
        table.append(editableCell(column.sessionId, row.name, cell, previous));
      } else {
        table.append(readOnlyCell(cell, index === editableIndex - 1));
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

function readOnlyCell(content: GridCell, isPrevious: boolean): HTMLElement {
  const cell = document.createElement('pre');
  cell.className = [
    'grid-cell',
    isPrevious ? 'grid-cell-previous' : '',
    content.unreadable ? 'grid-cell-unreadable' : '',
  ].filter(Boolean).join(' ');
  cell.textContent = content.lines.join('\n');
  if (content.unreadable) cell.title = 'Something here is not readable as a set';
  return cell;
}

function editableCell(sessionId: string, exercise: string, content: GridCell, previous: string[]): HTMLElement {
  const cell = document.createElement('textarea');
  cell.className = 'grid-cell grid-cell-today';
  cell.value = content.lines.join('\n');
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

  // Say so while it is being typed, rather than after it has been saved.
  const markUnreadable = () => {
    const bad = cell.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .some((line) => !/^(?:\/\/|#)/.test(line) && !parseSetLine(line).ok);
    cell.classList.toggle('grid-cell-unreadable', bad);
  };

  const save = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending.delete(save);
    store.saveCell(sessionId, exercise, cell.value.split('\n'));
  };

  cell.addEventListener('input', () => {
    resize();
    markUnreadable();
    pending.add(save);
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(save, SAVE_DELAY);
  });
  cell.addEventListener('blur', save);

  markUnreadable();
  requestAnimationFrame(resize);
  return cell;
}

function startButton(template: Template, root: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'start-row';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-wide';
  button.textContent = `Log today’s ${template.name}`;
  button.addEventListener('click', () => {
    const session = store.startTemplateSession(template.name);
    renderTemplate(root, template.key, session.id);
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
function addExerciseRow(template: Template, sessionId: string, root: HTMLElement): HTMLElement {
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
    renderTemplate(root, template.key, sessionId);
  });

  wrap.append(input, known, submit);
  return wrap;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${month}/${day}`;
}
