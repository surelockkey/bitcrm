/** Catalog rows live in the shared BitCRM_Deals table alongside deals. */
export const EXTERNAL_COMPANY_PK_PREFIX = 'EXTERNAL_COMPANY#';
export const EXTERNAL_COMPANY_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1. */
export const EXTERNAL_COMPANY_GSI1PK = 'CATALOG#EXTERNAL_COMPANY';
