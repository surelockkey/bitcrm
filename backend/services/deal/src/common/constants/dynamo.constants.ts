export const DEALS_TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
export const DEALS_GSI1_NAME = 'StageIndex';
export const DEALS_GSI2_NAME = 'TechIndex';
export const DEALS_GSI3_NAME = 'ContactIndex';
export const DEALS_GSI4_NAME = 'DispatcherIndex';

// Job attachments (photos/files): PK=DEAL#<id>, SK=ATTACH#<attachmentId>.
export const DEAL_ATTACHMENT_SK_PREFIX = 'ATTACH#';
export const dealAttachmentS3Key = (dealId: string, attachmentId: string) =>
  `deals/${dealId}/attachments/${attachmentId}`;
