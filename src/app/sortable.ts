/**
 * Drag to reorder, with a pointer rather than a mouse.
 *
 * HTML5 drag-and-drop does not exist on iOS, so this uses pointer events:
 * press the grip, and rows swap under your finger as you cross them. The
 * list's own DOM order is the model — when the finger lifts, whatever order
 * the rows are in is the answer.
 *
 * The grip is also a button, so the same reordering works from a keyboard
 * with the arrow keys.
 */

export interface SortableOptions {
  /** Called with the new order of `data-key` values once a drag finishes. */
  onReorder(keys: string[]): void;
}

export function makeSortable(list: HTMLElement, options: SortableOptions): void {
  let dragging: HTMLElement | null = null;

  const keys = () => [...list.children]
    .map((child) => (child as HTMLElement).dataset.key)
    .filter((key): key is string => Boolean(key));

  list.addEventListener('pointerdown', (event) => {
    const grip = (event.target as HTMLElement).closest<HTMLElement>('.grip');
    if (!grip) return;

    dragging = grip.closest('li');
    if (!dragging) return;

    dragging.classList.add('dragging');
    grip.setPointerCapture(event.pointerId);
    // Without this the page scrolls instead of the row moving.
    event.preventDefault();
  });

  list.addEventListener('pointermove', (event) => {
    if (!dragging) return;

    for (const sibling of list.children) {
      if (sibling === dragging || sibling.tagName !== 'LI') continue;

      const box = sibling.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      const position = sibling.compareDocumentPosition(dragging);

      if (event.clientY < middle && position & Node.DOCUMENT_POSITION_FOLLOWING) {
        list.insertBefore(dragging, sibling);
        break;
      }
      if (event.clientY > middle && position & Node.DOCUMENT_POSITION_PRECEDING) {
        list.insertBefore(dragging, sibling.nextSibling);
        break;
      }
    }
  });

  const finish = () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    options.onReorder(keys());
  };

  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);

  list.addEventListener('keydown', (event) => {
    const grip = (event.target as HTMLElement).closest<HTMLElement>('.grip');
    const row = grip?.closest('li');
    if (!row) return;

    if (event.key === 'ArrowUp' && row.previousElementSibling) {
      list.insertBefore(row, row.previousElementSibling);
    } else if (event.key === 'ArrowDown' && row.nextElementSibling) {
      list.insertBefore(row.nextElementSibling, row);
    } else {
      return;
    }

    event.preventDefault();
    grip?.focus();
    options.onReorder(keys());
  });
}
