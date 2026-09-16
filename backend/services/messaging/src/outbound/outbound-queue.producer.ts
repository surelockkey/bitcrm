import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { type MessageKey } from '../messages/messages.repository';
import { OUTBOUND_CONFIG, type OutboundConfig } from './outbound.config';

/** The `eventType` the outbound consumer dispatches on. */
export const OUTBOUND_JOB_EVENT = 'message.send';

/** One job on `messaging-outbound.fifo`: the key of a `queued` message. */
export type OutboundJob = MessageKey;

/** The slice of `SQSClient` the producer uses; tests hand in a recorder. */
export interface SqsSender {
  send(command: SendMessageCommand): Promise<unknown>;
}

export const OUTBOUND_SQS_CLIENT = Symbol('OUTBOUND_SQS_CLIENT');

export type OutboundJobHandler = (job: OutboundJob) => Promise<void>;

/**
 * Hands an accepted message to the send worker (design §4.4 step 3):
 * SQS FIFO, `MessageGroupId = conversationId` keeps one thread in order,
 * `MessageDeduplicationId = messageId` makes a re-enqueue harmless. The body
 * is the `EventMessage` envelope `SqsConsumerService` already parses.
 *
 * Without `MESSAGING_OUTBOUND_QUEUE_URL` (local dev, tests) the job goes to
 * the in-process worker on the next tick instead, so "send" still sends.
 */
@Injectable()
export class OutboundQueueProducer {
  private readonly logger = new Logger(OutboundQueueProducer.name);
  private readonly client?: SqsSender;
  private inline?: OutboundJobHandler;

  constructor(
    @Inject(OUTBOUND_CONFIG) private readonly config: Pick<OutboundConfig, 'queueUrl' | 'awsRegion' | 'awsEndpoint'>,
    @Optional() @Inject(OUTBOUND_SQS_CLIENT) client?: SqsSender,
  ) {
    if (client) {
      this.client = client;
    } else if (config.queueUrl) {
      this.client = new SQSClient({
        region: config.awsRegion,
        ...(config.awsEndpoint && {
          endpoint: config.awsEndpoint,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }),
      });
    }
  }

  get configured(): boolean {
    return Boolean(this.config.queueUrl);
  }

  /** The worker registers itself here; used only when no queue is configured. */
  setInlineHandler(handler: OutboundJobHandler): void {
    this.inline = handler;
  }

  /** `'queued'` on SQS, `'inline'` when the in-process worker took it, `'dropped'` when nobody can. */
  async enqueue(job: OutboundJob): Promise<'queued' | 'inline' | 'dropped'> {
    if (this.config.queueUrl && this.client) {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.config.queueUrl,
          MessageBody: JSON.stringify({
            eventType: OUTBOUND_JOB_EVENT,
            timestamp: new Date().toISOString(),
            source: 'messaging-service',
            payload: job,
          }),
          MessageGroupId: job.conversationId,
          MessageDeduplicationId: job.messageId,
        }),
      );
      return 'queued';
    }

    const handler = this.inline;
    if (handler) {
      setImmediate(() => {
        handler(job).catch((error) =>
          this.logger.error(`inline send of ${job.messageId} failed: ${error instanceof Error ? error.message : error}`),
        );
      });
      return 'inline';
    }

    this.logger.warn(`No outbound queue and no in-process worker: ${job.messageId} stays queued`);
    return 'dropped';
  }
}
