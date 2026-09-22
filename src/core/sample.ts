/**
 * The two pages from the photographed notebook, as sample data.
 *
 * They are dated the week before whenever the app is first opened, so the
 * first real page you write already has something to prefill from. They are
 * marked as samples and can be cleared in one tap.
 */

import type { Session } from './types';

const CHEST = `Dumbbell Incline Press
45x8
45x8
70x8
80x8
90x8
95x7
70x8

Chest Fly
47.5x12
47.5x12
17.5x12
17.5x12
35x12
35x12

Iso Chest Press
230x12
230x12
230x12

Dips
10
20x10
20x10
50x10
50x10`;

const BACK = `Pull Ups
8
10x8
10x8

Lat Pull Down
170x6
170x8
170x8

Rows (superset)
25x10 | 20x10
25x10 | 20x10
25x10 | 20x10

Curls
40x12
40x12
40x12`;

export function createSamples(today = new Date()): Session[] {
  const first = daysBefore(today, 7);
  const second = daysBefore(today, 6);

  return [
    page(first, 'Chest/Tris', CHEST),
    page(second, 'Back/Bis/Shoulders', BACK),
  ];
}

function page(date: Date, title: string, body: string): Session {
  const id = iso(date);
  return {
    id,
    date: id,
    text: `${title} ${date.getMonth() + 1}/${date.getDate()}\n${body}`,
    updatedAt: Date.now(),
    sample: true,
  };
}

function daysBefore(today: Date, days: number): Date {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  date.setDate(date.getDate() - days);
  return date;
}

function iso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
