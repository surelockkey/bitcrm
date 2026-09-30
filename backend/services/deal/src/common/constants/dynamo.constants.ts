export const DEALS_TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
export const DEALS_GSI1_NAME = 'StageIndex';
export const DEALS_GSI2_NAME = 'TechIndex';
export const DEALS_GSI3_NAME = 'ContactIndex';
export const DEALS_GSI4_NAME = 'DispatcherIndex';
/**
 * GSI5PK = STATUS#<superStatus>, GSI5SK = <scheduledDate|UNSCHED>#<slotStart|~>#DEAL#<id>.
 * The visit date as a key: the jobs list, the board and the schedule read a
 * window of days per status instead of the whole table. Written by
 * `statusScheduleKeys()` on every create / scheduling update, and by the
 * Workiz importer with the same shape.
 */
export const DEALS_GSI5_NAME = 'StatusScheduleIndex';
/**
 * GSI6PK = CLOSED#<YYYY-MM>, GSI6SK = <closedAt>#DEAL#<id> — sparse, closed deals
 * only, one partition a month: the report's "By: Job closed" window.
 */
export const DEALS_GSI6_NAME = 'ClosedIndex';
/**
 * GSI7PK = END#<YYYY-MM>, GSI7SK = <jobEndAt>#DEAL#<id> — the visit's END on
 * the account's clock (`YYYY-MM-DDTHH:MM`, or a bare day), one partition a
 * month: the Jobs report's "By: Job end date" (Workiz `report_by=3`), which
 * is neither the start nor the closing moment. A multi-day job ends months
 * after it starts, so no window on the start index can find it. Written by
 * `endIndexKeys()` on create and on every scheduling update; rows written
 * before the index existed get it from `backfill:end-index`.
 */
export const DEALS_GSI7_NAME = 'EndIndex';

// Job attachments (photos/files): PK=DEAL#<id>, SK=ATTACH#<attachmentId>.
export const DEAL_ATTACHMENT_SK_PREFIX = 'ATTACH#';
export const dealAttachmentS3Key = (dealId: string, attachmentId: string) =>
  `deals/${dealId}/attachments/${attachmentId}`;
