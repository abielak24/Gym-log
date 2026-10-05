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

import { makeEntry, metGoal, parseAmount, progress, summarise, type DailyEntry } from '../core/daily';
import { isoToday } from '../core/serialize';
import { friendlyDate, thousands } from './format';
import { toast } from './panels';
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

  section.append(addRow((name, goal) => {
    rows.push(makeEntry(name, goal));
    save();
    redraw();
  }));
  return section;
}

/**
 * Adding something to track, in two steps: what, then what you are aiming at.
 *
 * A row used to arrive with both boxes empty and the goal typed in afterwards
 * if at all, which made a goal optional in practice - and a tracked row with
 * no goal cannot be met or missed, so it is a number with nothing to say
 * about it. Asking for the goal before the row exists is what makes it part
 * of deciding to track the thing.
 */
function addRow(onAdd: (name: string, goal: string) => void): HTMLElement {
  const wrap = document.createElement('div');

  const form = document.createElement('form');
  form.className = 'add-exercise';
  wrap.append(form);

  const hint = document.createElement('p');
  hint.className = 'note';

  const field = (placeholder: string, label: string) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search';
    input.placeholder = placeholder;
    input.autocapitalize = 'words';
    input.setAttribute('aria-label', label);
    return input;
  };

  const button = (text: string, kind: string) => {
    const element = document.createElement('button');
    element.type = kind === 'submit' ? 'submit' : 'button';
    element.className = kind === 'submit' ? 'btn btn-primary' : 'btn btn-ghost';
    element.textContent = text;
    return element;
  };

  let step: ((event: Event) => void) | null = null;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    step?.(event);
  });

  const askName = () => {
    hint.remove();
    const name = field('Track something daily', 'Add something to track daily');
    const next = button('Next', 'submit');
    next.setAttribute('aria-label', 'Name what to track');
    form.replaceChildren(name, next);

    step = () => {
      const chosen = name.value.trim();
      if (!chosen) {
        toast('What do you want to count? Pushups, cardio, steps.');
        return;
      }
      askGoal(chosen);
    };
  };

  const askGoal = (name: string) => {
    const goal = field(`Daily goal for ${name}`, `Daily goal for ${name}`);
    goal.autocapitalize = 'none';
    const add = button('Add', 'submit');
    add.setAttribute('aria-label', `Start tracking ${name}`);
    const back = button('Back', 'ghost');
    back.setAttribute('aria-label', 'Change what to track');
    back.addEventListener('click', askName);

    form.replaceChildren(goal, add, back);
    wrap.append(hint);
    goal.focus();

    // Said as it is typed, because an unreadable goal is not refused - it is
    // kept as written, and there is simply nothing to measure against it.
    const describe = () => {
      const text = goal.value.trim();
      if (!text) {
        hint.textContent = `How much ${name} counts as a day done? Numbers like 100, 30min, 1h, 10k, 5mi.`;
        return;
      }
      const amount = parseAmount(text);
      hint.textContent = amount
        ? `Read as ${thousands(amount.amount)}${amount.unit ? ` ${amount.unit}` : ''} a day.`
        : `“${text}” is kept as written, but nothing can be measured against it.`;
    };

    describe();
    goal.addEventListener('input', describe);

    step = () => {
      const wanted = goal.value.trim();
      if (!wanted) {
        toast(`A daily goal for ${name} \u2014 it is what makes the day met or missed.`);
        return;
      }
      onAdd(name, wanted);
      askName();
    };
  };

  askName();
  return wrap;
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
