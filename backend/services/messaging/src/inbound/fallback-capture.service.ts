import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { S3Service } from '@bitcrm/shared';
import { MediaQueueService } from '../media/media-queue.service';
import { documentsKmsKeyId, inboundRawS3Key } from '../media/media.constants';

export interface CaptureResult {
  /** `messaging/inbound-raw/<day>/<sid>.json` when the S3 write succeeded. */
  s3Key?: string;
  /** Whether a replay job reached the media queue. */
  queued: boolean;
}

/**
 * The Fallback URL path (design §4.3): Twilio calls it when the primary
 * webhook failed or timed out — typically because DynamoDB or the CRM is
 * unavailable — so this deliberately touches neither. The raw form goes to
 * S3 (SSE-KMS) as the audit copy and onto the media queue as an
 * `inbound.replay` job, which runs the normal pipeline once the service is
 * healthy again; `PSID#` makes the replay idempotent against the primary
 * having half-succeeded.
 */
@Injectable()
export class FallbackCaptureService {
  private readonly logger = new Logger(FallbackCaptureService.name);

  constructor(
    private readonly mediaQueue: MediaQueueService,
    @Optional() private readonly s3?: S3Service,
  ) {}

  async capture(payload: Record<string, unknown>, at: string = new Date().toISOString()): Promise<CaptureResult> {
    const sid = firstString(payload.MessageSid, payload.SmsSid) ?? `nosid-${randomUUID()}`;
    const s3Key = inboundRawS3Key(at.slice(0, 10), sid);
    const result: CaptureResult = { queued: false };

    try {
      if (!this.s3) throw new Error('S3Service not available');
      await this.s3.putObject(s3Key, JSON.stringify({ capturedAt: at, payload }), {
        contentType: 'application/json',
        kmsKeyId: documentsKmsKeyId(),
        metadata: { source: 'twilio-fallback', messagesid: sid },
      });
      result.s3Key = s3Key;
    } catch (error) {
      this.logger.error(`Fallback capture of ${sid} to S3 failed: ${error instanceof Error ? error.message : error}`);
    }

    try {
      result.queued = await this.mediaQueue.enqueueInboundReplay({ s3Key: result.s3Key, payload, capturedAt: at });
    } catch (error) {
      this.logger.error(`Fallback replay of ${sid} not queued: ${error instanceof Error ? error.message : error}`);
    }

    if (result.s3Key || result.queued) {
      this.logger.warn(
        `Fallback webhook captured ${sid} (ErrorCode ${String(payload.ErrorCode ?? '?')}): s3=${result.s3Key ?? 'no'} queued=${result.queued}`,
      );
    } else {
      this.logger.error(`Fallback webhook could not capture ${sid} anywhere — rely on reconciliation`);
    }
    return result;
  }
}

const firstString = (...values: unknown[]): string | undefined => {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
};
