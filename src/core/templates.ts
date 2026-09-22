/**
 * Splits, read out of the log rather than set up in advance.
 *
 * A template is just "what this split has looked like lately": the exercises
 * from its recent sessions, ordered by how recently each was done. Adding an
 * exercise to a workout therefore adds it to the split, and one you quietly
 * stopped doing falls out after a few sessions — which is how a split
 * actually changes, rather than something you maintain in a settings screen.
 */

import type { Session, Template, TemplateOverride } from './types';
import { parsePage } from './parse';
import { normalizeName } from './normalize';

/** How many sessions back to look when deciding what a split contains. */
const RECENT_WINDOW = 5;

export function buildTemplates(sessions: Session[], overrides: TemplateOverride[] = []): Template[] {
  const byKey = new Map<string, Session[]>();
  const titles = new Map<string, string>();

  const newestFirst = [...sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  for (const session of newestFirst) {
    const title = parsePage(session.text).title.trim();
    if (!title) continue; // A page with no split name belongs to no split.

    const key = normalizeName(title);
    if (!key) continue;

    const group = byKey.get(key);
    if (group) group.push(session);
    else {
      byKey.set(key, [session]);
      titles.set(key, title); // The most recent spelling wins.
    }
  }

  const overrideByKey = new Map(overrides.map((o) => [o.key, o]));
  const templates: Template[] = [];

  for (const [key, group] of byKey) {
    templates.push(assemble(key, titles.get(key) ?? key, group, overrideByKey.get(key)));
  }

  // Splits created by hand that nothing has been logged under yet.
  for (const override of overrides) {
    if (override.created && !byKey.has(override.key)) {
      templates.push(assemble(override.key, override.name ?? override.key, [], override));
    }
  }

  return templates.sort((a, b) => (a.lastDate ?? '') < (b.lastDate ?? '') ? 1 : -1);
}

function assemble(key: string, title: string, group: Session[], override?: TemplateOverride): Template {
  const seen = new Map<string, string>();

  // Newest session first, so its order wins and older extras fall in behind.
  for (const session of group.slice(0, RECENT_WINDOW)) {
    for (const block of parsePage(session.text).exercises) {
      if (!block.key || block.sets.length === 0) continue;
      if (!seen.has(block.key)) seen.set(block.key, block.name);
    }
  }

  for (const extra of override?.extra ?? []) {
    if (!seen.has(extra.key)) seen.set(extra.key, extra.name);
  }

  const hidden = new Set(override?.hidden ?? []);
  let exercises = [...seen].map(([k, name]) => ({ key: k, name })).filter((e) => !hidden.has(e.key));

  if (override?.order?.length) {
    const rank = new Map(override.order.map((k, i) => [k, i]));
    // Anything the order does not mention keeps its derived place, after the rest.
    exercises = exercises.sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity));
  }

  return {
    key,
    name: override?.name ?? title,
    exercises,
    sessionIds: group.map((s) => s.id),
    lastDate: group[0]?.date ?? null,
  };
}

export function findTemplate(templates: Template[], key: string): Template | undefined {
  return templates.find((t) => t.key === key);
}
