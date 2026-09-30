/**
 * Warehouses and containers are listed off GSI1 (CategoryIndex) the way the
 * catalogs are: one constant partition per kind, so a list is a Query over
 * ~90 rows instead of a filtered Scan over the whole shared table.
 */
export const LOCATION_INDEX_PK = {
  warehouse: 'LOCATION#WAREHOUSE',
  container: 'LOCATION#CONTAINER',
} as const;

/**
 * The Workiz import writes a row for every location Workiz ever had — 119 of
 * the 207 containers are placeholders for locations deleted in Workiz
 * (`placeholder: true`, archived, "Workiz location #6142 (видалено у Workiz)").
 * Every list and count leaves them out with this filter, rather than by
 * dropping their index keys, so they still resolve by id (transfer history,
 * a placeholder that still holds units).
 */
export const NOT_PLACEHOLDER_FILTER = '(attribute_not_exists(placeholder) OR placeholder = :false)';
export const NOT_PLACEHOLDER_VALUES = { ':false': false } as const;

/**
 * What the `search` filter runs `contains` against: the trimmed, lowercased
 * name and nothing else. The sort key below carries the id too, and a UUID
 * has 32 hex digits — a search for "3" or "de" would match nearly every row
 * on the id instead of the name.
 */
export function locationSearchName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The index sort key: name order for the list, the id suffix so two "(3) VAN"
 * rows stay apart and the key is unique.
 */
export function locationSortKey(name: string, id: string): string {
  return `${locationSearchName(name)}#${id}`;
}
