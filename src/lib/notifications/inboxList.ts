/**
 * How the list is divided up, and what counts as new.
 *
 * Pure, and apart from the screen, because both rules are easy to get subtly
 * wrong and neither needs a browser to check. "Today" is since local midnight
 * rather than the last 24 hours — something from 11pm yesterday is yesterday's
 * news to the person reading it, whatever the clock says.
 */

export interface Dated {
  at: string;
}

export interface Group<T> {
  label: "Today" | "This week" | "Earlier";
  items: T[];
}

export function groupByAge<T extends Dated>(items: readonly T[], now = Date.now()): Group<T>[] {
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  // Six days before this morning, so "this week" is the last seven days of
  // calendar days rather than a rolling 168 hours.
  const weekStart = midnight - 6 * 86_400_000;

  const groups: Group<T>[] = [
    {label: "Today", items: []},
    {label: "This week", items: []},
    {label: "Earlier", items: []},
  ];

  for (const item of items) {
    const at = Date.parse(item.at);
    if (!Number.isFinite(at)) continue;
    const group = at >= midnight ? groups[0] : at >= weekStart ? groups[1] : groups[2];
    group.items.push(item);
  }

  return groups.filter((group) => group.items.length > 0);
}

/**
 * How many of these this device has not seen.
 *
 * A device that has never opened the screen has seen nothing, so everything
 * counts — the alternative, treating a first visit as all-read, hides the
 * replies somebody already has waiting.
 */
export function unreadCount(items: readonly Dated[], seenAt: string | null): number {
  if (seenAt === null) return items.length;
  return items.filter((item) => item.at > seenAt).length;
}
