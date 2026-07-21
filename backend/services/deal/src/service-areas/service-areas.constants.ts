/** Single-table (BitCRM_Deals) key layout for the service-area catalog. */
export const SERVICE_AREA_PK_PREFIX = 'SERVICE_AREA#';
export const SERVICE_AREA_SK = 'METADATA';
/** Reuses the existing GSI1 (StageIndex) as a catalog list index. */
export const SERVICE_AREA_GSI1PK = 'CATALOG#SERVICE_AREA';

/** Miles buffered around a ZIP centroid when the entry omits `+N miles`. */
export const DEFAULT_ZIP_RADIUS_MILES = 3;
