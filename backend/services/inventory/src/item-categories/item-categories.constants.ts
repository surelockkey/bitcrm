/** Catalog rows live in the shared BitCRM_Inventory table alongside products. */
export const ITEM_CATEGORY_PK_PREFIX = 'ITEM_CATEGORY#';
export const ITEM_CATEGORY_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1 (CategoryIndex). */
export const ITEM_CATEGORY_GSI1PK = 'CATALOG#ITEM_CATEGORY';
