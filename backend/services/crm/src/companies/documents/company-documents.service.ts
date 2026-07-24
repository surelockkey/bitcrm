import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { S3Service } from '@bitcrm/shared';
import { type CompanyDocumentType, type JwtUser } from '@bitcrm/types';
import { CompanyDocumentsRepository } from './company-documents.repository';
import { UploadCompanyDocumentDto } from './dto/upload-company-document.dto';
import { companyDocS3Key } from '../../common/constants/dynamo.constants';

/**
 * W-9 / COI compliance documents for a company. Access is gated by the
 * `companies` permission at the controller, so no role logic lives here.
 */
@Injectable()
export class CompanyDocumentsService {
  private readonly logger = new Logger(CompanyDocumentsService.name);

  constructor(
    private readonly s3: S3Service,
    private readonly repository: CompanyDocumentsRepository,
  ) {}

  async requestUpload(
    companyId: string,
    dto: UploadCompanyDocumentDto,
    caller: JwtUser,
  ): Promise<{ uploadUrl: string; s3Key: string; headers: Record<string, string> }> {
    const s3Key = companyDocS3Key(companyId, dto.docType);
    // The SSE-KMS headers are part of the signature — the client must replay
    // them on the PUT or S3 returns 403.
    const { url: uploadUrl, headers } = await this.s3.getPresignedUpload(s3Key, {
      contentType: dto.contentType,
      kmsKeyId: process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents',
    });

    await this.repository.upsert({
      companyId,
      docType: dto.docType,
      s3Key,
      contentType: dto.contentType,
      uploadedBy: caller.id,
      uploadedAt: new Date().toISOString(),
    });
    this.logger.log(`Company document upload requested: ${companyId}/${dto.docType} by ${caller.id}`);
    return { uploadUrl, s3Key, headers };
  }

  async getDownloadUrl(
    companyId: string,
    docType: CompanyDocumentType,
  ): Promise<{ downloadUrl: string }> {
    const doc = await this.repository.getByType(companyId, docType);
    if (!doc) throw new NotFoundException('Document not found');
    const downloadUrl = await this.s3.getPresignedDownloadUrl(doc.s3Key, 300);
    return { downloadUrl };
  }

  async list(companyId: string) {
    const docs = await this.repository.listByCompany(companyId);
    return docs.map((d) => ({ docType: d.docType, contentType: d.contentType, uploadedAt: d.uploadedAt }));
  }

  async delete(companyId: string, docType: CompanyDocumentType): Promise<void> {
    const doc = await this.repository.getByType(companyId, docType);
    if (!doc) throw new NotFoundException('Document not found');
    await this.s3.deleteObject(doc.s3Key);
    await this.repository.delete(companyId, docType);
  }
}
