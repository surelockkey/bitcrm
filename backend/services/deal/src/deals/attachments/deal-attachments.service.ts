import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { S3Service } from '@bitcrm/shared';
import { type DealAttachmentMeta, type JwtUser } from '@bitcrm/types';
import { DealAttachmentsRepository } from './deal-attachments.repository';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { dealAttachmentS3Key } from '../../common/constants/dynamo.constants';

/**
 * Photos and files attached to a job. Access is gated by the `deals` permission
 * at the controller, so no role logic lives here.
 */
@Injectable()
export class DealAttachmentsService {
  private readonly logger = new Logger(DealAttachmentsService.name);

  constructor(
    private readonly s3: S3Service,
    private readonly repository: DealAttachmentsRepository,
  ) {}

  async requestUpload(
    dealId: string,
    dto: UploadAttachmentDto,
    caller: JwtUser,
  ): Promise<{ id: string; uploadUrl: string; s3Key: string; headers: Record<string, string> }> {
    const id = randomUUID();
    const s3Key = dealAttachmentS3Key(dealId, id);
    // The SSE-KMS headers are part of the signature — the client must replay
    // them on the PUT or S3 returns 403.
    const { url: uploadUrl, headers } = await this.s3.getPresignedUpload(s3Key, {
      contentType: dto.contentType,
      kmsKeyId: process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents',
    });

    await this.repository.create({
      dealId,
      id,
      fileName: dto.fileName,
      contentType: dto.contentType,
      size: dto.size,
      category: dto.category,
      s3Key,
      uploadedBy: caller.id,
      uploadedAt: new Date().toISOString(),
    });
    this.logger.log(`Deal attachment upload requested: ${dealId}/${id} by ${caller.id}`);
    return { id, uploadUrl, s3Key, headers };
  }

  async getDownloadUrl(dealId: string, id: string): Promise<{ downloadUrl: string }> {
    const att = await this.repository.get(dealId, id);
    if (!att) throw new NotFoundException('Attachment not found');
    const downloadUrl = await this.s3.getPresignedDownloadUrl(att.s3Key, 300);
    return { downloadUrl };
  }

  async list(dealId: string): Promise<DealAttachmentMeta[]> {
    const items = await this.repository.listByDeal(dealId);
    return items
      .map((a) => ({
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        size: a.size,
        category: a.category,
        uploadedBy: a.uploadedBy,
        uploadedAt: a.uploadedAt,
      }))
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  }

  async delete(dealId: string, id: string): Promise<void> {
    const att = await this.repository.get(dealId, id);
    if (!att) throw new NotFoundException('Attachment not found');
    await this.s3.deleteObject(att.s3Key);
    await this.repository.delete(dealId, id);
  }
}
