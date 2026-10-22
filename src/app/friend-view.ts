/**
 * Somebody else's log, read-only.
 *
 * The Friends tab is not a scoreboard. What a training partner actually
 * wants is to see what you did — the sets, in the grid they are used to —
 * not a rank. So this renders their pages with the same shapes as your own
 * and no way to type into any of them.
 *
 * Read-only is not a styling choice: there is no route on the server that
 * writes to another account, so nothing here could reach their phone even
 * if it tried.
 */

import { buildGrid, type GridCell } from '../core/grid';
import { buildTemplates } from '../core/templates';
import { parsePage } from '../core/parse';
import type { Session, Template } from '../core/types';
import { fetchMemberLog, type MemberLogProblem } from './crew';
import { friendlyDate } from './format';
import * as store from './store';

/** How many of their workouts the page lists before it stops. */
const RECENT = 20;

/**
 * Their log, kept for as long as the tab is open.
 *
 * Opening a split and coming back is one tap, and refetching a whole log for
 * it would make the tab feel like it was on a modem.
 */
const cached = new Map<string, Session[]>();

function nameOf(memberId: string): string {
  return store.board()?.members.find((m) => m.memberId === memberId)?.name ?? 'Their log';
}

function heading(root: HTMLElement, text: string): void {
  const element = document.createElement('h1');
  element.className = 'exercise-name';
  element.textContent = text;
  root.append(element);
}

function note(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'note';
  element.textContent = text;
  return element;
}

function backLink(href: string, text: string): HTMLElement {
  const link = document.createElement('a');
  link.className = 'btn btn-ghost';
  link.href = href;
  link.textContent = text;
  return link;
}

/**
 * Fetch once, then draw.
 *
 * Anything rendered after an await checks the screen has not moved on, or a
 * slow log paints itself over whatever the person opened next.
 */
async function withLog(
  root: HTMLElement,
  memberId: string,
  draw: (sessions: Session[]) => void,
): Promise<void> {
  const held = cached.get(memberId);
  if (held) {
    draw(held);
    return;
  }

  const at = location.hash;
  const loading = note('Loading their log…');
  root.append(loading);

  const result = await fetchMemberLog(memberId);
  if (location.hash !== at) return;

  loading.remove();
  if (!Array.isArray(result)) {
    root.append(problem(result, root, memberId, draw));
    return;
  }

  cached.set(memberId, result);
  draw(result);
}

/** What went wrong, in words, and what to do about it. */
function problem(
  reason: MemberLogProblem,
  root: HTMLElement,
  memberId: string,
  draw: (sessions: Session[]) => void,
): HTMLElement {
  const wrap = document.createElement('div');

  const said: Record<MemberLogProblem, string> = {
    offline: 'Could not reach the server. Their log will load when you are back online.',
    'signed-out': 'This device has been signed out. Sign in again to read their log.',
    'not-allowed': 'You are not on this board yet, so their log is not open to you. '
      + 'It takes a moment after joining — try again.',
    gone: 'They are not on this board any more, so their log is no longer shared here.',
    'stale-link': 'This crew’s link has changed. Ask whoever started it for the current one.',
    'not-deployed': 'The server has not been updated to share logs yet. '
      + 'Whoever runs it needs to redeploy the worker.',
  };

  const bar = document.createElement('div');
  bar.className = reason === 'offline' ? 'banner banner-nudge' : 'banner banner-warn';
  const text = document.createElement('span');
  text.textContent = said[reason];
  bar.append(text);
  wrap.append(bar);

  // Everything but a stale link is worth another go without leaving.
  if (reason !== 'stale-link') {
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn btn-ghost';
    again.textContent = 'Try again';
    again.addEventListener('click', () => {
      cached.delete(memberId);
      wrap.remove();
      void withLog(root, memberId, draw);
    });
    wrap.append(again);
  }

  return wrap;
}

export function renderFriend(root: HTMLElement, memberId: string): void {
  root.replaceChildren();
  heading(root, nameOf(memberId));
  root.append(backLink('#/friends', '‹ Everyone'));

  void withLog(root, memberId, (sessions) => {
    if (sessions.length === 0) {
      root.append(note('Nothing logged yet.'));
      return;
    }

    const templates = buildTemplates(sessions);
    if (templates.length > 0) {
      root.append(sectionTitle('Their splits'));
      const list = document.createElement('ul');
      list.className = 'split-list';
      for (const template of templates) list.append(splitRow(template, memberId));
      root.append(list);
    }

    root.append(sectionTitle('Recent workouts'));
    const recent = document.createElement('ul');
    recent.className = 'history-list';
    for (const session of sessions.slice(0, RECENT)) recent.append(workoutRow(session));
    root.append(recent);

    if (sessions.length > RECENT) {
      root.append(note(`Showing the last ${RECENT} of ${sessions.length}.`));
    }
  });
}

function sectionTitle(text: string): HTMLElement {
  const element = document.createElement('h2');
  element.className = 'section-title';
  element.textContent = text;
  return element;
}

function splitRow(template: Template, memberId: string): HTMLLIElement {
  const item = document.createElement('li');

  const link = document.createElement('a');
  link.className = 'split-link';
  link.href = `#/friend/${encodeURIComponent(memberId)}/${encodeURIComponent(template.key)}`;

  const name = document.createElement('span');
  name.className = 'split-name';
  name.textContent = template.name;

  const when = document.createElement('span');
  when.className = 'split-when';
  when.textContent = template.lastDate ? `last ${friendlyDate(template.lastDate)}` : 'nothing logged';

  const exercises = document.createElement('span');
  exercises.className = 'split-exercises';
  exercises.textContent = template.exercises.map((e) => e.name).join(' · ');

  link.append(name, when, exercises);
  item.append(link);
  return item;
}

/** One of their days, exactly as they wrote it. */
function workoutRow(session: Session): HTMLLIElement {
  const item = document.createElement('li');
  const page = parsePage(session.text);

  const when = document.createElement('span');
  when.className = 'history-when';
  when.textContent = `${friendlyDate(session.date)} · ${page.title || 'untitled'}`;

  const body = document.createElement('pre');
  body.className = 'history-sets';
  // Everything but the header line, which the row above already says.
  body.textContent = session.text
    .split('\n')
    .filter((_line, index) => index !== page.headerLine)
    .join('\n')
    .trim();

  item.append(when, body);
  return item;
}

export function renderFriendSplit(root: HTMLElement, memberId: string, key: string): void {
  root.replaceChildren();
  heading(root, nameOf(memberId));
  root.append(backLink(`#/friend/${encodeURIComponent(memberId)}`, '‹ Their log'));

  void withLog(root, memberId, (sessions) => {
    const template = buildTemplates(sessions).find((t) => t.key === key);
    if (!template) {
      root.append(note('That split is not in their log any more.'));
      return;
    }

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = template.name;
    root.append(title);

    root.append(readOnlyGrid(template, sessions));
  });
}

/**
 * Their grid, with no column open.
 *
 * `buildGrid` with no editable session gives exactly that, so the shape is
 * the one from your own splits and every cell is a `pre`.
 */
function readOnlyGrid(template: Template, sessions: Session[]): HTMLElement {
  const data = buildGrid(template, sessions);

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
    head.className = 'grid-date';
    head.textContent = shortDate(column.date);
    table.append(head);
  }

  for (const row of data.rows) {
    const name = document.createElement('div');
    name.className = 'grid-name';
    name.textContent = row.name;
    table.append(name);
    for (const cell of row.cells) table.append(readOnlyCell(cell));
  }

  scroller.append(table);
  requestAnimationFrame(() => {
    scroller.scrollLeft = scroller.scrollWidth;
  });
  return scroller;
}

function readOnlyCell(content: GridCell): HTMLElement {
  const cell = document.createElement('pre');
  cell.className = `grid-cell${content.unreadable ? ' grid-cell-unreadable' : ''}`;
  cell.textContent = content.lines.join('\n');
  return cell;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** Their log may have changed since the tab was opened. */
export function forgetFriendLogs(): void {
  cached.clear();
}
