/** Template rows live in the shared BitCRM_Inventory table beside the containers. */
export const CONTAINER_TEMPLATE_PK_PREFIX = 'CONTAINER_TEMPLATE#';
export const CONTAINER_TEMPLATE_SK = 'METADATA';
/** Partition of the list on the existing GSI1 (CategoryIndex) — the catalog pattern. */
export const CONTAINER_TEMPLATE_GSI1PK = 'CATALOG#CONTAINER_TEMPLATE';

/** The list sort key, and what a case-insensitive name lookup matches exactly. */
export function containerTemplateSortKey(name: string): string {
  return name.trim().toLowerCase();
}
