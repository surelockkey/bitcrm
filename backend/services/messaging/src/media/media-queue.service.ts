import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { type EventMessage } from '@bitcrm/shared';
import {
  INBOUND_REPLAY_JOB,
  MEDIA_COPY_JOB,
  type InboundReplayJob,
  type MediaCopyJob,
} from './media.jobs';

export const MEDIA_QUEUE_OPTIONS = Symbol('MEDIA_QUEUE_OPTIONS');

export interface MediaQueueOptions {
  queueUrl?: string;
  region?: string;
  endpoint?: string;
  /** Overridable for tests. */
  client?: Pick<SQSClient, 'send'>;
}

/**
 * Producer side of the service's own `messaging-media` queue
 * (`MESSAGING_MEDIA_QUEUE_URL`, design §4.6): the webhook drops a job here
 * and answers Twilio; the worker in `MediaModule` does the slow part. The
 * fallback webhook uses the same queue to replay a captured payload (§4.3).
 *
 * Unset queue URL (local dev without LocalStack) → `enabled` is false and
 * every enqueue is a logged no-op: attachments stay `pending`, which the
 * reconciliation can re-drive later.
 */
@Injectable()
export class MediaQueueService {
  private readonly logger = new Logger(MediaQueueService.name);
  private readonly queueUrl?: string;
  private readonly client?: Pick<SQSClient, 'send'>;

  constructor(@Optional() @Inject(MEDIA_QUEUE_OPTIONS) opts: MediaQueueOptions = {}) {
    this.queueUrl = opts.queueUrl ?? process.env.MESSAGING_MEDIA_QUEUE_URL ?? undefined;
    if (!this.queueUrl) return;
    const endpoint = opts.endpoint ?? process.env.AWS_ENDPOINT;
    this.client =
      opts.client ??
      new SQSClient({
        region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1',
        ...(endpoint && {
          endpoint,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }),
      });
  }

  get enabled(): boolean {
    return Boolean(this.queueUrl && this.client);
  }

  /** `true` when the job was accepted by SQS; `false` when the queue is not configured. */
  enqueueMediaCopy(job: MediaCopyJob): Promise<boolean> {
    return this.send(MEDIA_COPY_JOB, job, `${job.attachments.length} media of ${job.providerSid}`);
  }

  enqueueInboundReplay(job: InboundReplayJob): Promise<boolean> {
    return this.send(INBOUND_REPLAY_JOB, job, `replay of ${String(job.payload.MessageSid ?? '?')}`);
  }

  private async send(eventType: string, payload: unknown, what: string): Promise<boolean> {
    if (!this.queueUrl || !this.client) {
      this.logger.warn(`MESSAGING_MEDIA_QUEUE_URL unset — not queuing ${what}`);
      return false;
    }
    const body: EventMessage = {
      eventType,
      timestamp: new Date().toISOString(),
      source: 'messaging-service',
      payload,
    };
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(body) }),
    );
    this.logger.log(`Queued ${eventType}: ${what}`);
    return true;
  }
}
