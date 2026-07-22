/** Catalog rows live in the shared BitCRM_Deals table alongside deals. */
export const JOB_TYPE_PK_PREFIX = 'JOB_TYPE#';
export const JOB_TYPE_SK = 'METADATA';
/** Partition for the catalog list query on the existing GSI1. */
export const JOB_TYPE_GSI1PK = 'CATALOG#JOB_TYPE';
