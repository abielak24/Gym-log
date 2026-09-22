/**
 * Changing a split on purpose.
 *
 * Splits keep themselves up to date from what gets written, so this screen
 * is for the deliberate edits that cannot be inferred: a rename, a reorder,
 * dropping an exercise you have not stopped doing but no longer want here.
 * None of it touches a page — the log stays exactly as it was written.
 */

import type { Template } from '../core/types';
import * as store from './store';

export function renderEditSplit(root: HTMLElement, key: string): void {
  const template = store.getTemplate(key);
  root.replaceChildren();

  if (!template) {
    const missing = document.createElement('p');
    missing.className = 'empty';
    missing.textContent = 'No such split.';
    root.append(missing);
    return;
  }

  const heading = document.createElement('h1');
  heading.className = 'exercise-name';
  heading.textContent = 'Edit split';
  root.append(heading);

  root.append(renameField(template, root));
  root.append(exerciseList(template, root));

  const done = document.createElement('a');
  done.className = 'btn btn-primary btn-wide';
  done.href = `#/t/${encodeURIComponent(template.key)}`;
  done.textContent = 'Done';
  root.append(done);
}

function renameField(template: Template, root: HTMLElement): HTMLElement {
  const form = document.createElement('form');
  form.className = 'add-exercise';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'search';
  input.value = template.name;
  input.setAttribute('aria-label', 'Split name');

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-ghost';
  save.textContent = 'Rename';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name || name === template.name) return;
    store.saveOverride(template.key, { name });
    renderEditSplit(root, template.key);
  });

  form.append(input, save);
  return form;
}

function exerciseList(template: Template, root: HTMLElement): HTMLElement {
  const order = template.exercises.map((e) => e.key);

  const list = document.createElement('ul');
  list.className = 'edit-list';

  template.exercises.forEach((exercise, index) => {
    const row = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'edit-name';
    name.textContent = exercise.name;

    const up = iconButton('↑', `Move ${exercise.name} up`, index === 0, () => {
      const next = [...order];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      store.saveOverride(template.key, { order: next });
      renderEditSplit(root, template.key);
    });

    const down = iconButton('↓', `Move ${exercise.name} down`, index === order.length - 1, () => {
      const next = [...order];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      store.saveOverride(template.key, { order: next });
      renderEditSplit(root, template.key);
    });

    const remove = iconButton('×', `Remove ${exercise.name} from this split`, false, () => {
      const hidden = store.overrideFor(template.key)?.hidden ?? [];
      store.saveOverride(template.key, { hidden: [...hidden, exercise.key] });
      renderEditSplit(root, template.key);
    });

    row.append(name, up, down, remove);
    list.append(row);
  });

  const hidden = store.overrideFor(template.key)?.hidden ?? [];
  if (hidden.length > 0) {
    const restore = document.createElement('p');
    restore.className = 'note';
    restore.textContent = 'Removed from this split: ';

    for (const key of hidden) {
      const name = store.getHistory().displayNames.get(key) ?? key;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-chip';
      button.textContent = `${name} +`;
      button.addEventListener('click', () => {
        store.saveOverride(template.key, { hidden: hidden.filter((k) => k !== key) });
        renderEditSplit(root, template.key);
      });
      restore.append(button);
    }
    list.append(restore);
  }

  return list;
}

function iconButton(glyph: string, label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost btn-icon';
  button.textContent = glyph;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}
