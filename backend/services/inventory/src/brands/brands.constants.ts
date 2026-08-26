/** Catalog rows live in the shared BitCRM_Inventory table alongside products. */
export const BRAND_PK_PREFIX = 'BRAND#';
export const BRAND_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1 (CategoryIndex). */
export const BRAND_GSI1PK = 'CATALOG#BRAND';
