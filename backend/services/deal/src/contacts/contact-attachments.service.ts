import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { S3Service } from '@bitcrm/shared';
import {
  type ContactAttachment,
  type ContactFileListItem,
  type DealAttachment,
  type DealAttachmentMeta,
  type JwtUser,
} from '@bitcrm/types';
import { DealAttachmentsRepository } from '../deals/attachments/deal-attachments.repository';
import { DealsRepository } from '../deals/deals.repository';
import { UploadAttachmentDto } from '../deals/attachments/dto/upload-attachment.dto';
import { UpdateAttachmentDto } from '../deals/attachments/dto/update-attachment.dto';
import { contactAttachmentS3Key } from '../common/constants/dynamo.constants';

export interface ContactFilesPage {
  items: ContactFileListItem[];
  nextCursor?: string;
}

/**
 * The client card's Files: every file of the client's jobs and the files
 * uploaded on the client itself (Workiz's "Upload file" on the client card),
 * one list newest first off GSI10; plus presign / download / rename / delete
 * of the client's own files, the same flow as a job's. A job's file is still
 * downloaded through its job (`GET /deals/:dealId/attachments/:id`) — the
 * list says which is which by carrying `dealId` or not.
 *
 * The contact itself lives in crm-service and is not verified here: an
 * upload on an unknown contact id makes an orphan row nothing lists.
 */
@Injectable()
export class ContactAttachmentsService {
  private readonly logger = new Logger(ContactAttachmentsService.name);

  constructor(
    private readonly s3: S3Service,
    private readonly repository: DealAttachmentsRepository,
    private readonly deals: DealsRepository,
  ) {}

  async listByContact(contactId: string, limit: number, cursor?: string): Promise<ContactFilesPage> {
    const page = await this.repository.listByContact(contactId, limit, cursor);
    const dealIds = [...new Set(page.items.map((a) => (a as DealAttachment).dealId).filter((id): id is string => Boolean(id)))];
    const numbers = new Map<string, string>();
    if (dealIds.length) {
      for (const deal of await this.deals.findByIds(dealIds)) {
        if (deal.dealNumber) numbers.set(deal.id, deal.dealNumber);
      }
    }
    return {
      items: page.items.map((a) => {
        const dealId = (a as DealAttachment).dealId;
        const dealNumber = dealId ? numbers.get(dealId) : undefined;
        return {
          ...this.toMeta(a),
          contactId,
          ...(dealId && { dealId }),
          ...(dealNumber && { dealNumber }),
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  async requestUpload(
    contactId: string,
    dto: UploadAttachmentDto,
    caller: JwtUser,
  ): Promise<{ id: string; uploadUrl: string; s3Key: string; headers: Record<string, string> }> {
    const id = randomUUID();
    const s3Key = contactAttachmentS3Key(contactId, id);
    // The SSE-KMS headers are part of the signature — the client must replay
    // them on the PUT or S3 returns 403.
    const { url: uploadUrl, headers } = await this.s3.getPresignedUpload(s3Key, {
      contentType: dto.contentType,
      kmsKeyId: process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents',
    });
    await this.repository.createForContact({
      contactId,
      id,
      fileName: dto.fileName,
      contentType: dto.contentType,
      size: dto.size,
      category: dto.category,
      s3Key,
      uploadedBy: caller.id,
      uploadedAt: new Date().toISOString(),
    });
    this.logger.log(`Contact attachment upload requested: ${contactId}/${id} by ${caller.id}`);
    return { id, uploadUrl, s3Key, headers };
  }

  async getDownloadUrl(contactId: string, id: string): Promise<{ downloadUrl: string }> {
    const att = await this.requireOwn(contactId, id);
    return { downloadUrl: await this.s3.getPresignedDownloadUrl(att.s3Key, 300) };
  }

  async update(contactId: string, id: string, dto: UpdateAttachmentDto, caller: JwtUser): Promise<DealAttachmentMeta> {
    await this.requireOwn(contactId, id);
    const updated = await this.repository.updateForContact(contactId, id, {
      fileName: dto.fileName,
      description: dto.description,
    });
    this.logger.log(`Contact attachment updated: ${contactId}/${id} by ${caller.id}`);
    return this.toMeta(updated);
  }

  async delete(contactId: string, id: string, caller: JwtUser): Promise<void> {
    const att = await this.requireOwn(contactId, id);
    await this.s3.deleteObject(att.s3Key);
    await this.repository.deleteForContact(contactId, id);
    this.logger.log(`Contact attachment deleted: ${contactId}/${id} by ${caller.id}`);
  }

  private async requireOwn(contactId: string, id: string): Promise<ContactAttachment> {
    const att = await this.repository.getForContact(contactId, id);
    if (!att) throw new NotFoundException('Attachment not found');
    return att;
  }

  /** Client-facing shape — never the S3 key. */
  private toMeta(a: DealAttachment | ContactAttachment): DealAttachmentMeta {
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
}
