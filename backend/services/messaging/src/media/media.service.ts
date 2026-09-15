import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BusinessMetricsService,
  S3Service,
  TWILIO_CONFIG,
  TwilioRest,
  type TwilioCredentials,
} from '@bitcrm/shared';
import { MessagesRepository } from '../messages/messages.repository';
import { MEDIA_MAX_BYTES, deleteTwilioMediaEnabled, documentsKmsKeyId, mediaS3Key } from './media.constants';
import { type MediaCopyAttachment, type MediaCopyJob } from './media.jobs';

export const MEDIA_SERVICE_OPTIONS = Symbol('MEDIA_SERVICE_OPTIONS');

export interface MediaServiceOptions {
  /** Overridable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Overrides `MESSAGING_DELETE_TWILIO_MEDIA`. */
  deleteFromTwilio?: boolean;
  /** Overrides `DOCUMENTS_KMS_KEY_ID`. */
  kmsKeyId?: string;
  maxBytes?: number;
  /** Per-download budget. */
  timeoutMs?: number;
}

export interface MediaCopyReport {
  stored: number;
  /** Already `stored` from an earlier delivery of the same job. */
  skipped: number;
  /** Twilio answered 4xx (gone, forbidden): marked `failed`, not retried. */
  failed: number;
  /** Transient problems (network, 5xx, S3): thrown at the end so SQS redelivers. */
  retryable: number;
}

/** A download that is not worth retrying — the source said so. */
class PermanentMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentMediaError';
  }
}

/**
 * Worker side of inbound MMS (design §4.6): for each attachment of a
 * `messaging.media.copy` job, download `MediaUrl{N}` from Twilio with HTTP
 * Basic auth (`AccountSid:AuthToken` — "Enforce HTTP Basic Auth for media
 * access" must be on for the Messaging Service), write it to S3 under
 * `messaging/<conversationId>/<messageId>/<attachmentId>` with SSE-KMS, and
 * flip `attachments[i]` to `stored` with the key and size. Optionally delete
 * the media from Twilio afterwards.
 *
 * Idempotent per attachment: a redelivered job skips what is already
 * `stored`. A 4xx from Twilio marks the attachment `failed` and moves on;
 * anything transient is collected and rethrown after the other files were
 * handled, so SQS retries (visibility timeout → 5 receives → DLQ) only what
 * is still pending.
 *
 * Files are buffered, not streamed: Twilio caps an inbound MMS at 5 MB, and
 * S3 needs the length up front for a single PutObject.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly fetchFn: typeof fetch;
  private readonly deleteFromTwilio: boolean;
  private readonly kmsKeyId: string;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(
    @Inject(TWILIO_CONFIG) private readonly credentials: TwilioCredentials,
    private readonly twilioRest: TwilioRest,
    private readonly s3: S3Service,
    private readonly messages: MessagesRepository,
    @Optional() @Inject(MEDIA_SERVICE_OPTIONS) opts: MediaServiceOptions = {},
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.deleteFromTwilio = opts.deleteFromTwilio ?? deleteTwilioMediaEnabled();
    this.kmsKeyId = opts.kmsKeyId ?? documentsKmsKeyId();
    this.maxBytes = opts.maxBytes ?? MEDIA_MAX_BYTES;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async copy(job: MediaCopyJob): Promise<MediaCopyReport> {
    const key = { conversationId: job.conversationId, createdAt: job.createdAt, messageId: job.messageId };
    const message = await this.messages.get(key);
    if (!message) {
      // Nothing to attach to (the message was never stored, or the job outlived it): not retryable.
      this.logger.warn(`Media job for missing message ${job.conversationId}/${job.messageId} dropped`);
      return { stored: 0, skipped: job.attachments.length, failed: 0, retryable: 0 };
    }
    const stored = new Set((message.attachments ?? []).filter((a) => a.status === 'stored').map((a) => a.id));

    const report: MediaCopyReport = { stored: 0, skipped: 0, failed: 0, retryable: 0 };
    const transient: string[] = [];

    for (const attachment of job.attachments) {
      if (stored.has(attachment.id)) {
        report.skipped++;
        continue;
      }
      try {
        await this.copyOne(job, attachment);
        report.stored++;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (error instanceof PermanentMediaError) {
          report.failed++;
          this.logger.warn(`Media ${attachment.id} of ${job.providerSid} failed permanently: ${reason}`);
          await this.messages.updateAttachment(key, attachment.id, { status: 'failed' });
        } else {
          report.retryable++;
          transient.push(`${attachment.id}: ${reason}`);
          this.logger.error(`Media ${attachment.id} of ${job.providerSid} not copied (will retry): ${reason}`);
        }
      }
    }

    this.businessMetrics?.sqsMessagesProcessed.inc({
      event_type: 'messaging.media.copy',
      status: transient.length ? 'retry' : 'ok',
    });
    if (transient.length) {
      throw new Error(`${transient.length} media of ${job.providerSid} not copied: ${transient.join('; ')}`);
    }
    return report;
  }

  private async copyOne(job: MediaCopyJob, attachment: MediaCopyAttachment): Promise<void> {
    if (!attachment.sourceUrl) throw new PermanentMediaError('no source URL');

    const { body, contentType } = await this.download(attachment.sourceUrl, attachment.contentType);
    const s3Key = mediaS3Key(job.conversationId, job.messageId, attachment.id);
    await this.s3.putObject(s3Key, body, {
      contentType,
      kmsKeyId: this.kmsKeyId,
      metadata: {
        source: 'twilio',
        messagesid: job.providerSid,
        ...(attachment.providerMediaSid && { mediasid: attachment.providerMediaSid }),
      },
    });

    const key = { conversationId: job.conversationId, createdAt: job.createdAt, messageId: job.messageId };
    const applied = await this.messages.updateAttachment(key, attachment.id, {
      status: 'stored',
      s3Key,
      size: body.byteLength,
      contentType,
    });
    if (!applied) {
      this.logger.warn(`Attachment ${attachment.id} vanished from ${job.messageId} after upload; ${s3Key} kept`);
      return;
    }
    this.logger.log(`Stored ${s3Key} (${body.byteLength} bytes, ${contentType})`);

    if (this.deleteFromTwilio && attachment.providerMediaSid) {
      await this.deleteAtTwilio(job.providerSid, attachment.providerMediaSid);
    }
  }

  private async download(url: string, declaredType: string): Promise<{ body: Buffer; contentType: string }> {
    const auth = Buffer.from(`${this.credentials.accountSid}:${this.credentials.authToken}`).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // fetch follows Twilio's 302 to the media CDN; the CDN URL is signed, so
      // the Authorization header being dropped on the cross-origin hop is fine.
      const res = await this.fetchFn(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const reason = `HTTP ${res.status} from ${url}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentMediaError(reason);
        throw new Error(reason);
      }
      const declaredLength = Number(res.headers.get('content-length'));
      if (declaredLength > this.maxBytes) {
        throw new PermanentMediaError(`${declaredLength} bytes exceeds the ${this.maxBytes}-byte limit`);
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.byteLength > this.maxBytes) {
        throw new PermanentMediaError(`${body.byteLength} bytes exceeds the ${this.maxBytes}-byte limit`);
      }
      const contentType = res.headers.get('content-type')?.split(';')[0].trim() || declaredType;
      return { body, contentType };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Best-effort: the copy is safe in S3 either way, so a failure here is only logged. */
  private async deleteAtTwilio(messageSid: string, mediaSid: string): Promise<void> {
    try {
      await this.twilioRest.run((client) => client.messages(messageSid).media(mediaSid).remove());
      this.logger.log(`Deleted media ${mediaSid} of ${messageSid} at Twilio`);
    } catch (error) {
      this.logger.warn(
        `Could not delete media ${mediaSid} of ${messageSid} at Twilio: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
