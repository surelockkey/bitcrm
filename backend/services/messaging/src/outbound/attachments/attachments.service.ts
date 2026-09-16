import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { S3Service } from '@bitcrm/shared';
import { type JwtUser, type Message } from '@bitcrm/types';
import { MAX_ATTACHMENT_BYTES } from '../dto/send-message.dto';
import { OUTBOUND_CONFIG, type OutboundConfig } from '../outbound.config';
import { uploadKey } from '../send.service';
import { type RequestAttachmentUploadDto } from './dto/request-attachment-upload.dto';

/** What the composer gets back: where to PUT, with the exact headers, and the id to send with. */
export interface PresignedAttachmentUpload {
  /** Send this back as `attachments[].id` on the message. */
  id: string;
  s3Key: string;
  uploadUrl: string;
  /** Must be replayed verbatim on the PUT — the SSE-KMS headers are part of the signature. */
  headers: Record<string, string>;
  /** Seconds the upload URL stays valid. */
  expiresIn: number;
  fileName: string;
  contentType: string;
  size: number;
  maxBytes: number;
}

/**
 * Outbound MMS media (design §4.6 "Вихідні"): the browser PUTs the file to
 * S3 through a presigned URL with SSE-KMS (`alias/bitcrm-documents`, the
 * deal-attachments flow), under `messaging/uploads/<userId>/<uuid>`; when
 * the message is sent the worker hands Twilio short-lived presigned GET
 * URLs (`mediaUrlTtlSeconds`, 1 h by default) — Twilio fetches the media
 * once and hosts its own copy.
 */
@Injectable()
export class OutboundAttachmentsService {
  private readonly logger = new Logger(OutboundAttachmentsService.name);

  constructor(
    private readonly s3: S3Service,
    @Inject(OUTBOUND_CONFIG)
    private readonly config: Pick<OutboundConfig, 'kmsKeyId' | 'uploadUrlTtlSeconds' | 'mediaUrlTtlSeconds'>,
  ) {}

  /** `POST /attachments/presign`. */
  async requestUpload(dto: RequestAttachmentUploadDto, caller: JwtUser): Promise<PresignedAttachmentUpload> {
    const id = randomUUID();
    const s3Key = uploadKey(caller.id, id);
    const { url: uploadUrl, headers } = await this.s3.getPresignedUpload(s3Key, {
      contentType: dto.contentType,
      expiresIn: this.config.uploadUrlTtlSeconds,
      kmsKeyId: this.config.kmsKeyId,
    });
    this.logger.log(`Attachment upload presigned: ${s3Key} (${dto.contentType}, ${dto.size} B) by ${caller.id}`);
    return {
      id,
      s3Key,
      uploadUrl,
      headers,
      expiresIn: this.config.uploadUrlTtlSeconds,
      fileName: dto.fileName,
      contentType: dto.contentType,
      size: dto.size,
      maxBytes: MAX_ATTACHMENT_BYTES,
    };
  }

  /**
   * The `mediaUrl[]` for a `messages.create`: one presigned GET per stored
   * attachment, in order. Attachments without an object (`pending`,
   * `deferred`, `failed`) are skipped rather than sent as a broken link.
   */
  async mediaUrlsFor(message: Pick<Message, 'attachments'>): Promise<string[]> {
    const stored = (message.attachments ?? []).filter((a) => a.status === 'stored' && a.s3Key);
    return Promise.all(stored.map((a) => this.s3.getPresignedDownloadUrl(a.s3Key!, this.config.mediaUrlTtlSeconds)));
  }
}
