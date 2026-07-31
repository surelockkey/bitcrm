/** Catalog rows live in the shared BitCRM_Deals table alongside deals. */
export const JOB_STATUS_PK_PREFIX = 'JOB_STATUS#';
export const JOB_STATUS_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1. */
export const JOB_STATUS_GSI1PK = 'CATALOG#JOB_STATUS';
