/**
 * S3 layout of everything the messaging service stores in the documents
 * bucket (design §4.3, §4.6). Objects are written with SSE-KMS under
 * `DOCUMENTS_KMS_KEY_ID`, the same key deal attachments use.
 *
 *   messaging/<conversationId>/<messageId>/<attachmentId>   MMS media copied from Twilio
 *   messaging/inbound-raw/<YYYY-MM-DD>/<MessageSid>.json    fallback-webhook capture
 */
export const MESSAGING_S3_PREFIX = 'messaging';

export const mediaS3Key = (conversationId: string, messageId: string, attachmentId: string) =>
  `${MESSAGING_S3_PREFIX}/${conversationId}/${messageId}/${attachmentId}`;

export const inboundRawS3Key = (day: string, messageSid: string) =>
  `${MESSAGING_S3_PREFIX}/inbound-raw/${day}/${messageSid}.json`;

/** The KMS key every messaging object is encrypted with (as `deal-attachments.service.ts`). */
export const documentsKmsKeyId = () => process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents';

/**
 * `MESSAGING_DELETE_TWILIO_MEDIA=true` removes each media resource from
 * Twilio once its copy is in S3 (less PII at the provider, no second copy).
 * Off by default — the owner's call (design §4.6).
 */
export const deleteTwilioMediaEnabled = () => process.env.MESSAGING_DELETE_TWILIO_MEDIA === 'true';

/** Hard ceiling for one media file; Twilio caps inbound MMS at 5 MB total. */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;
