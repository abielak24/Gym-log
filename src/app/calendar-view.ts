/**
 * The month, with the workouts written on it.
 *
 * Nothing is scheduled here and nothing is planned: a day is filled in
 * because a page was written for it. Tapping a trained day opens that
 * session for editing, which is how a workout logged in a hurry gets
 * finished; tapping an untrained one offers to put a workout on it.
 */

import { buildMonth, monthKey, shiftMonth, type CalendarDay } from '../core/calendar';
import { isoToday } from '../core/serialize';
import { friendlyDate } from './format';
import * as store from './store';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function renderCalendar(root: HTMLElement, key?: string): void {
  const month = buildMonth(key || monthKey(new Date()), store.sessions());
  root.replaceChildren();

  const head = document.createElement('div');
  head.className = 'cal-head';

  const back = navButton('‹', `Go to ${shiftMonth(month.key, -1)}`, () => {
    location.hash = `#/cal/${month.previous}`;
  });

  const title = document.createElement('div');
  const label = document.createElement('h1');
  label.textContent = month.label;
  const count = document.createElement('p');
  count.className = 'split-when';
  count.textContent = month.trained === 0
    ? 'nothing logged this month'
    : `${month.trained} day${month.trained === 1 ? '' : 's'} trained`;
  title.append(label, count);

  const forward = navButton('›', `Go to ${shiftMonth(month.key, 1)}`, () => {
    location.hash = `#/cal/${month.next}`;
  });

  head.append(back, title, forward);
  root.append(head);

  const table = document.createElement('div');
  table.className = 'cal';

  WEEKDAYS.forEach((day, index) => {
    const cell = document.createElement('div');
    cell.className = 'cal-weekday';
    cell.textContent = day;
    cell.setAttribute('aria-label', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]);
    table.append(cell);
  });

  for (const week of month.weeks) {
    for (const day of week) table.append(dayCell(day, root));
  }

  root.append(table);
  root.append(legend());
}

function dayCell(day: CalendarDay, root: HTMLElement): HTMLElement {
  const classes = ['cal-day'];
  if (!day.inMonth) classes.push('cal-outside');
  if (day.isToday) classes.push('cal-today');
  if (day.sessions.length > 0) classes.push('cal-trained');

  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = classes.join(' ');
  cell.disabled = day.isFuture;

  const number = document.createElement('span');
  number.className = 'cal-number';
  number.textContent = String(day.dayOfMonth);
  cell.append(number);

  for (const session of day.sessions) {
    const tag = document.createElement('span');
    tag.className = 'cal-split';
    // An untitled page still happened; it just belongs to no split.
    tag.textContent = session.short;
    tag.title = session.title || 'untitled';
    cell.append(tag);
  }

  cell.setAttribute(
    'aria-label',
    day.sessions.length
      ? `${friendlyDate(day.date)}: ${day.sessions.map((s) => s.title || 'untitled').join(', ')}`
      : `${friendlyDate(day.date)}: nothing logged`,
  );

  cell.addEventListener('click', () => {
    if (day.sessions.length === 1) {
      open(day.sessions[0]);
      return;
    }
    if (day.sessions.length > 1) {
      chooseSession(root, day);
      return;
    }
    offerSplits(root, day);
  });

  return cell;
}

function open(session: { id: string; key: string }): void {
  // Straight to the split's grid with that day's column open, or to the page
  // itself when the workout belongs to no split.
  location.hash = session.key
    ? `#/t/${encodeURIComponent(session.key)}/${encodeURIComponent(session.id)}`
    : `#/page/${encodeURIComponent(session.id)}`;
}

function chooseSession(root: HTMLElement, day: CalendarDay): void {
  panel(root, `${friendlyDate(day.date)}`, day.sessions.map((session) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-chip';
    button.textContent = session.title || 'untitled';
    button.addEventListener('click', () => open(session));
    return button;
  }));
}

/** Put a workout on a day that has none — usually one you forgot to write down. */
function offerSplits(root: HTMLElement, day: CalendarDay): void {
  const templates = store.getTemplates();

  const buttons = templates.map((template) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-chip';
    button.textContent = template.name;
    button.addEventListener('click', () => {
      const session = store.startTemplateSession(template.name, store.dateFromIso(day.date));
      location.hash = `#/t/${encodeURIComponent(template.key)}/${encodeURIComponent(session.id)}`;
    });
    return button;
  });

  const heading = day.date === isoToday() ? 'Log today' : `Add a workout on ${friendlyDate(day.date)}`;
  panel(root, heading, buttons.length ? buttons : [note('No splits yet — start one from Home.')]);
}

function panel(root: HTMLElement, heading: string, children: HTMLElement[]): void {
  root.querySelector('.cal-panel')?.remove();

  const box = document.createElement('div');
  box.className = 'cal-panel';

  const title = document.createElement('h2');
  title.textContent = heading;
  box.append(title);

  const row = document.createElement('div');
  row.className = 'cal-panel-row';
  row.append(...children);
  box.append(row);

  root.append(box);
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function legend(): HTMLElement {
  const text = document.createElement('p');
  text.className = 'note';
  text.textContent = 'Tap a day you trained to open and edit it, or an empty one to add a workout you forgot to write down.';
  return text;
}

function navButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost btn-icon';
  button.textContent = glyph;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function note(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'note';
  element.textContent = text;
  return element;
}
