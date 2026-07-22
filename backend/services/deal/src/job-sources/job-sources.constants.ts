/** Catalog rows live in the shared BitCRM_Deals table alongside deals. */
export const JOB_SOURCE_PK_PREFIX = 'JOB_SOURCE#';
export const JOB_SOURCE_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1. */
export const JOB_SOURCE_GSI1PK = 'CATALOG#JOB_SOURCE';
