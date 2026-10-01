/** Catalog rows live in the shared BitCRM_Deals table alongside deals. */
export const CLIENT_TAG_PK_PREFIX = 'CLIENT_TAG#';
export const CLIENT_TAG_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1. */
export const CLIENT_TAG_GSI1PK = 'CATALOG#CLIENT_TAG';
