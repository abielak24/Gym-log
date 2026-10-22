/** Small display helpers shared by the page, the log and the history views. */

export function friendlyDate(iso: string, today = new Date()): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((midnight.getTime() - date.getTime()) / 86400000);

  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  if (days >= 7 && days < 14) return 'last week';
  return `${month}/${day}`;
}

/**
 * A number with separators, keeping whatever decimals it really has.
 *
 * Rounding was fine while this only ever counted lifts, and wrong the moment
 * it was handed a weight or a goal: 2.5 is a real plate and `3` is a lie
 * about it.
 */
export function thousands(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
