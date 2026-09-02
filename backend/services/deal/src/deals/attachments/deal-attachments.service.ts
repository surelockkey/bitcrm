import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { S3Service } from '@bitcrm/shared';
import {
  TimelineEventType,
  type DealAttachment,
  type DealAttachmentMeta,
  type JwtUser,
} from '@bitcrm/types';
import { TimelineRepository } from '../../timeline/timeline.repository';
import { DealAttachmentsRepository } from './deal-attachments.repository';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { UpdateAttachmentDto } from './dto/update-attachment.dto';
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
    private readonly timeline: TimelineRepository,
  ) {}

  /**
   * A photo appearing on, being renamed on, or vanishing from a job is part of
   * what happened to it, so it lands on the timeline like every other change.
   * Best-effort: history must never block the attachment operation itself.
   */
  private async logTimeline(
    dealId: string,
    eventType: TimelineEventType,
    caller: JwtUser,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.timeline.addEntry({
        id: randomUUID(),
        dealId,
        eventType,
        actorId: caller.id,
        actorName: caller.email,
        timestamp: new Date().toISOString(),
        details,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to log ${eventType} on deal ${dealId}: ${(error as Error).message}`,
      );
    }
  }

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
    await this.logTimeline(dealId, TimelineEventType.ATTACHMENT_ADDED, caller, {
      attachmentId: id,
      fileName: dto.fileName,
      category: dto.category,
      size: dto.size,
      contentType: dto.contentType,
    });
    return { id, uploadUrl, s3Key, headers };
  }

  async update(
    dealId: string,
    id: string,
    dto: UpdateAttachmentDto,
    caller: JwtUser,
  ): Promise<DealAttachmentMeta> {
    const att = await this.repository.get(dealId, id);
    if (!att) throw new NotFoundException('Attachment not found');
    const updated = await this.repository.update(dealId, id, {
      fileName: dto.fileName,
      description: dto.description,
    });
    this.logger.log(`Deal attachment updated: ${dealId}/${id} by ${caller.id}`);
    const renamed = updated.fileName !== att.fileName;
    const redescribed = (updated.description ?? '') !== (att.description ?? '');
    if (renamed || redescribed) {
      await this.logTimeline(dealId, TimelineEventType.ATTACHMENT_RENAMED, caller, {
        attachmentId: id,
        fileName: updated.fileName,
        ...(renamed ? { previousFileName: att.fileName } : {}),
        ...(redescribed ? { description: updated.description ?? null } : {}),
      });
    }
    return this.toMeta(updated);
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
      .map((a) => this.toMeta(a))
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  }

  /** Client-facing shape — never exposes the S3 key or the deal id. */
  private toMeta(a: DealAttachment): DealAttachmentMeta {
    return {
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      size: a.size,
      category: a.category,
      description: a.description,
      uploadedBy: a.uploadedBy,
      uploadedAt: a.uploadedAt,
    };
  }

  async delete(dealId: string, id: string, caller: JwtUser): Promise<void> {
    const att = await this.repository.get(dealId, id);
    if (!att) throw new NotFoundException('Attachment not found');
    await this.s3.deleteObject(att.s3Key);
    await this.repository.delete(dealId, id);
    await this.logTimeline(dealId, TimelineEventType.ATTACHMENT_REMOVED, caller, {
      attachmentId: id,
      fileName: att.fileName,
      category: att.category,
    });
  }
}
