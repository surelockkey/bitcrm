/** Catalog rows live in the shared BitCRM_Deals table alongside deals. */
export const JOB_TAG_PK_PREFIX = 'JOB_TAG#';
export const JOB_TAG_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1. */
export const JOB_TAG_GSI1PK = 'CATALOG#JOB_TAG';
