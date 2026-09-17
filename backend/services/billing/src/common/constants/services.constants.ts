export const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
export const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
export const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
export const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

/** Web origin the client-portal links point at. */
export const portalBaseUrl = () =>
  (process.env.PORTAL_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** SSE-KMS key for everything billing writes to S3 (same key as deal attachments). */
export const documentsKmsKeyId = () => process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents';
