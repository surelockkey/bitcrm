import { CompanyDocumentType } from '../enums/company-document-type.enum';

/**
 * Metadata for a company compliance document (W-9 / COI) stored encrypted
 * (SSE-KMS) in S3 under `companies/<companyId>/<docType>`. Record key is
 * PK=COMPANY#<companyId>, SK=DOC#<docType>. Mirrors {@link TechnicianDocument}.
 */
export interface CompanyDocument {
  companyId: string;
  docType: CompanyDocumentType;
  s3Key: string;
  contentType: string;
  uploadedBy: string;
  uploadedAt: string;
}
