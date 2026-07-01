/**
 * Metadata for a sensitive technician document stored (encrypted, SSE-KMS) in
 * S3. The bytes live in S3 under `technicians/<userId>/<docType>`; this record
 * (PK=USER#<userId>, SK=DOC#<docType>) tracks pointer + provenance. The file is
 * only ever served via short-TTL presigned URLs.
 */
export type DocumentType =
  | 'drivers_license_front'
  | 'drivers_license_back'
  | 'profile_photo'
  | 'bank_document';

export interface TechnicianDocument {
  userId: string;
  docType: DocumentType;
  s3Key: string;
  contentType: string;
  uploadedBy: string;
  uploadedAt: string;
}
