/** Catalog rows live in the shared BitCRM_Deals table alongside deals. */
export const CUSTOM_FIELD_PK_PREFIX = 'CUSTOM_FIELD#';
export const CUSTOM_FIELD_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1. */
export const CUSTOM_FIELD_GSI1PK = 'CATALOG#CUSTOM_FIELD';
