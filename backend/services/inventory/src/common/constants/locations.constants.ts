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
 * The index sort key: name order for the list, the id suffix so two "(3) VAN"
 * rows stay apart and the key is unique.
 */
export function locationSortKey(name: string, id: string): string {
  return `${name.trim().toLowerCase()}#${id}`;
}
