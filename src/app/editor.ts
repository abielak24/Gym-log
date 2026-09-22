/**
 * The page itself: one text surface, no fields, no buttons between you and
 * the next set.
 *
 * Two layers sit on top of each other. The textarea holds the real text and
 * draws it normally; behind it a backdrop mirrors the same text invisibly,
 * painting a background behind lines the parser could not read, and printing
 * last session's sets in grey below the cursor. Both layers share their font
 * and padding exactly, so the two stay in register as the text wraps.
 */

import { parsePage } from '../core/parse';
import { ghostLines, lastTime, suggestNames } from '../core/history';
import type { ExerciseBlock, Page } from '../core/types';
import * as store from './store';
import { friendlyDate } from './format';

export interface EditorHandle {
  element: HTMLElement;
  focus(): void;
  flush(): void;
  destroy(): void;
}

const SAVE_DELAY = 300;

export function createEditor(sessionId: string, initialText: string): EditorHandle {
  const element = document.createElement('div');
  element.className = 'editor-wrap';
  element.innerHTML = `
    <div class="editor">
      <div class="backdrop" aria-hidden="true"><div class="highlights"></div></div>
      <textarea class="page-text" spellcheck="false" autocorrect="off" autocapitalize="words"
        aria-label="Workout page"></textarea>
    </div>
    <div class="hintbar" role="status">
      <div class="hint-main"></div>
      <div class="hint-actions"></div>
    </div>
    <div class="sheet" hidden></div>
  `;

  const textarea = element.querySelector('textarea') as HTMLTextAreaElement;
  const highlights = element.querySelector('.highlights') as HTMLElement;
  const editor = element.querySelector('.editor') as HTMLElement;
  const hintMain = element.querySelector('.hint-main') as HTMLElement;
  const hintActions = element.querySelector('.hint-actions') as HTMLElement;
  const sheet = element.querySelector('.sheet') as HTMLElement;

  textarea.value = initialText;

  let page: Page = parsePage(textarea.value);
  let ghost: string[] = [];
  let saveTimer: number | undefined;

  function flush(): void {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    store.saveText(sessionId, textarea.value, page.date);
  }

  function scheduleSave(): void {
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flush, SAVE_DELAY);
  }

  function caretLine(): number {
    return textarea.value.slice(0, textarea.selectionStart).split('\n').length - 1;
  }

  /** The exercise block the cursor is sitting in, if any. */
  function blockAt(line: number): { block: ExerciseBlock; index: number } | null {
    let found: { block: ExerciseBlock; index: number } | null = null;
    page.exercises.forEach((block, index) => {
      if (block.headingLine <= line) found = { block, index };
    });
    return found;
  }

  function render(): void {
    page = parsePage(textarea.value);

    const line = caretLine();
    const context = blockAt(line);
    const history = store.getHistory();

    // Ghost text only makes sense at the end of the page, where there is
    // nothing underneath for it to collide with.
    const isLastBlock = context !== null && context.index === page.exercises.length - 1;
    ghost = context && isLastBlock
      ? ghostLines(history, context.block.name, context.block.sets.length, sessionId)
      : [];

    paint(highlights, page, ghost);
    editor.style.setProperty('--ghost-lines', String(ghost.length));

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;

    renderHint(context?.block ?? null, line);
  }

  function renderHint(block: ExerciseBlock | null, line: number): void {
    const history = store.getHistory();
    hintMain.replaceChildren();
    hintActions.replaceChildren();

    const onHeading = block ? block.headingLine === line : false;
    const typed = onHeading ? textarea.value.split('\n')[line]?.trim() ?? '' : '';

    // While a name is being typed, offer the ones already in the log.
    if (onHeading && typed.length >= 2 && !lastTime(history, typed, sessionId)) {
      const names = suggestNames(history, typed).slice(0, 3);
      if (names.length) {
        hintMain.append(label('did you mean'));
        for (const name of names) {
          hintMain.append(button(name, 'chip', () => replaceLine(line, name)));
        }
      }
    }

    if (hintMain.childElementCount === 0 && block) {
      const previous = lastTime(history, block.name, sessionId);
      if (previous) {
        hintMain.append(label(`last time · ${friendlyDate(previous.date)}`));
        const sets = document.createElement('span');
        sets.className = 'hint-sets';
        sets.textContent = previous.lines.join('   ');
        hintMain.append(sets);
      } else if (block.sets.length > 0) {
        hintMain.append(label('first time for this one'));
      }
    }

    if (ghost.length > 0) {
      hintActions.append(button(`Fill ${ghost.length}`, 'primary', fillGhost));
    }

    const problems = page.flagged.length + page.emptyExercises.length;
    if (problems > 0) {
      hintActions.append(button(`${problems} to check`, 'warn', () => openSheet()));
    }
  }

  function fillGhost(): void {
    if (ghost.length === 0) return;
    const base = textarea.value.replace(/\s*$/, '');
    textarea.value = `${base}\n${ghost.join('\n')}\n`;
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    textarea.focus();
    render();
    scheduleSave();
  }

  function replaceLine(index: number, text: string): void {
    const lines = textarea.value.split('\n');
    lines[index] = text;
    const before = lines.slice(0, index + 1).join('\n').length;
    textarea.value = lines.join('\n');
    textarea.selectionStart = textarea.selectionEnd = before;
    textarea.focus();
    render();
    scheduleSave();
  }

  function commentLine(index: number): void {
    const lines = textarea.value.split('\n');
    const current = lines[index] ?? '';
    if (/^\s*(?:\/\/|#)/.test(current)) return;
    lines[index] = current.replace(/^(\s*)/, '$1// ');
    textarea.value = lines.join('\n');
    render();
    scheduleSave();
    openSheet();
  }

  function goToLine(index: number): void {
    const lines = textarea.value.split('\n');
    const position = lines.slice(0, index + 1).join('\n').length;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = position;
    closeSheet();
    render();
  }

  function openSheet(): void {
    sheet.replaceChildren();
    sheet.hidden = false;

    const title = document.createElement('h2');
    title.textContent = 'Lines this page could not read';
    sheet.append(title);

    const note = document.createElement('p');
    note.className = 'sheet-note';
    note.textContent = 'These are kept exactly as you typed them — they just do not count towards history.';
    sheet.append(note);

    const list = document.createElement('ul');
    for (const flagged of page.flagged) {
      list.append(problemRow(flagged.text.trim(), flagged.reason ?? '', flagged.index));
    }
    for (const empty of page.emptyExercises) {
      list.append(problemRow(empty.name, 'read as an exercise name, but no sets under it', empty.headingLine));
    }
    sheet.append(list);
    sheet.append(button('Done', 'primary', closeSheet));
  }

  function problemRow(text: string, reason: string, index: number): HTMLLIElement {
    const row = document.createElement('li');

    const line = document.createElement('button');
    line.className = 'problem-line';
    line.type = 'button';
    line.innerHTML = '';
    const code = document.createElement('code');
    code.textContent = text || '(blank)';
    const why = document.createElement('span');
    why.className = 'problem-why';
    why.textContent = reason;
    line.append(code, why);
    line.addEventListener('click', () => goToLine(index));

    row.append(line, button("It's a note", 'ghost', () => commentLine(index)));
    return row;
  }

  function closeSheet(): void {
    sheet.hidden = true;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Tab' && ghost.length > 0) {
      event.preventDefault();
      fillGhost();
    }
  }

  textarea.addEventListener('input', () => {
    render();
    scheduleSave();
  });
  textarea.addEventListener('keydown', onKeyDown);
  textarea.addEventListener('click', render);
  textarea.addEventListener('keyup', render);
  textarea.addEventListener('blur', flush);

  render();

  return {
    element,
    focus: () => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      render();
    },
    flush,
    destroy: () => {
      flush();
      textarea.removeEventListener('keydown', onKeyDown);
    },
  };
}

/** Mirror the text as block spans, one per line, plus the grey ghost lines. */
function paint(target: HTMLElement, page: Page, ghost: string[]): void {
  const children: HTMLElement[] = [];

  // The cursor sits on the empty line at the end of the page. Let the first
  // ghost line occupy it, so what you are about to type and what you typed
  // last time line up instead of being split by a gap.
  const lines = ghost.length > 0 && page.lines.at(-1)?.kind === 'blank'
    ? page.lines.slice(0, -1)
    : page.lines;

  for (const info of lines) {
    const span = document.createElement('span');
    span.className = `ln ln-${info.kind}`;
    // A zero-width space keeps an empty line's height identical to the textarea's.
    span.textContent = info.text === '' ? '​' : info.text;
    if (info.reason) span.title = info.reason;
    children.push(span);
  }

  for (const line of ghost) {
    const span = document.createElement('span');
    span.className = 'ln ln-ghost';
    span.textContent = line;
    children.push(span);
  }

  target.replaceChildren(...children);
}

function label(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'hint-label';
  span.textContent = text;
  return span;
}

function button(text: string, variant: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `btn btn-${variant}`;
  element.textContent = text;
  // `mousedown` would steal focus from the textarea before the tap registers.
  element.addEventListener('mousedown', (e) => e.preventDefault());
  element.addEventListener('click', onClick);
  return element;
}
