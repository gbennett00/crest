/** A category as the pickers list it (see lib/budget/category-options.ts). */
export type ListedCategory = { id: string; name: string; groupName: string };

/**
 * Groups categories under their group names, in the order given (callers pass
 * Plan order), keeping only those whose name or group name contains `query`
 * (case-insensitive, trimmed). An empty query keeps everything.
 */
export function groupCategories<T extends ListedCategory>(
  categories: readonly T[],
  query: string,
): [groupName: string, categories: T[]][] {
  const q = query.trim().toLowerCase();
  const map = new Map<string, T[]>();
  for (const c of categories) {
    if (q && !c.name.toLowerCase().includes(q) && !c.groupName.toLowerCase().includes(q)) {
      continue;
    }
    const list = map.get(c.groupName);
    if (list) list.push(c);
    else map.set(c.groupName, [c]);
  }
  return [...map.entries()];
}

/**
 * Splits `text` around the first case-insensitive match of `query`, for
 * highlighting it. No match (or an empty query) gives the whole text as `before`.
 */
export function splitMatch(
  text: string,
  query: string,
): { before: string; match: string; after: string } {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return { before: text, match: "", after: "" };
  return {
    before: text.slice(0, at),
    match: text.slice(at, at + q.length),
    after: text.slice(at + q.length),
  };
}
