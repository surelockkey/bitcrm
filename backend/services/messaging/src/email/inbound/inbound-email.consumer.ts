import { Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { parseSqsBody } from '../sqs-poller';
import { InboundEmailService, type InboundMailLocation } from './inbound-email.service';

/** SES receipt notification (S3 action with `topic_arn`), the slice the consumer reads. */
interface SesReceivedNotification {
  notificationType?: string;
  mail?: { messageId?: string; timestamp?: string; source?: string; destination?: string[] };
  receipt?: {
    recipients?: string[];
    spamVerdict?: { status?: string };
    virusVerdict?: { status?: string };
    action?: { type?: string; bucketName?: string; objectKey?: string; objectKeyPrefix?: string };
  };
}

/** An S3 event notification (`s3:ObjectCreated:*` on the prefix), the alternative feed. */
interface S3EventNotification {
  Records?: Array<{ eventSource?: string; s3?: { bucket?: { name?: string }; object?: { key?: string } } }>;
}

/**
 * Turns whatever lands on `messaging-inbound-email` into "a mail is at
 * s3://bucket/key" and runs the pipeline. Two shapes are understood: the SES
 * `Received` notification the receipt rule's S3 action publishes (carries
 * the SES message id, the envelope recipients and the spam / virus
 * verdicts), and a bare S3 `ObjectCreated` event (nothing but the key). A
 * body that is neither is logged and dropped — retrying cannot fix it;
 * a pipeline failure throws so SQS redelivers and eventually parks it.
 */
@Injectable()
export class InboundEmailConsumer {
  private readonly logger = new Logger(InboundEmailConsumer.name);

  constructor(
    private readonly inbound: InboundEmailService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /** The SQS handler: the raw body of one queue message. */
  async handle(body: string): Promise<void> {
    const locations = locationsOf(parseSqsBody(body));
    if (!locations.length) {
      this.logger.warn(`Dropping an inbound-email notification with no S3 object in it: ${body.slice(0, 200)}`);
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: 'ses.inbound', status: 'dropped' });
      return;
    }
    for (const location of locations) {
      const result = await this.inbound.ingest(location);
      this.businessMetrics?.sqsMessagesProcessed.inc({ event_type: 'ses.inbound', status: result.outcome });
      this.logger.log(`Inbound mail s3://${location.bucket}/${location.key}: ${result.outcome}${result.conversationId ? ` in ${result.conversationId}` : ''}`);
    }
  }
}

/** The S3 objects a queue body points at, in either shape; empty when it points at none. */
export function locationsOf(parsed: unknown): InboundMailLocation[] {
  if (!parsed || typeof parsed !== 'object') return [];

  const ses = parsed as SesReceivedNotification;
  if (ses.notificationType === 'Received') {
    const action = ses.receipt?.action;
    if (action?.type === 'S3' && action.bucketName && action.objectKey) {
      return [
        {
          bucket: action.bucketName,
          key: action.objectKey,
          sesMessageId: ses.mail?.messageId,
          recipients: ses.receipt?.recipients,
          receivedAt: ses.mail?.timestamp,
          spamVerdict: ses.receipt?.spamVerdict?.status,
          virusVerdict: ses.receipt?.virusVerdict?.status,
        },
      ];
    }
    return [];
  }

  const s3 = parsed as S3EventNotification;
  if (Array.isArray(s3.Records)) {
    return s3.Records.flatMap((r) => {
      const bucket = r.s3?.bucket?.name;
      const key = r.s3?.object?.key;
      if (!bucket || !key) return [];
      // S3 URL-encodes keys in event records (spaces arrive as `+`).
      return [{ bucket, key: decodeURIComponent(key.replace(/\+/g, ' ')) }];
    });
  }
  return [];
}
