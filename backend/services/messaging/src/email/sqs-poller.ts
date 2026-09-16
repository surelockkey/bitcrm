import { Logger } from '@nestjs/common';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient, type Message } from '@aws-sdk/client-sqs';

/**
 * A long-poll loop for queues whose bodies are NOT the `EventMessage`
 * envelope the shared `SqsConsumerService` dispatches on — SES publishes its
 * own JSON (`{ eventType, mail, delivery… }` for events, `{ notificationType:
 * 'Received', receipt… }` for inbound mail), so the shared consumer would
 * look up a handler for `Delivery` and hand it `payload: undefined`.
 *
 * Same contract otherwise: a handler that throws leaves the message on the
 * queue (visibility timeout → redelivery → DLQ after 5 receives); a handler
 * that returns deletes it. Receive errors back off exponentially so a queue
 * that is not there (local dev) does not spam the log.
 */
export interface SqsPollerOptions {
  queueUrl: string;
  region: string;
  endpoint?: string;
  waitTimeSeconds?: number;
  maxMessages?: number;
  /** Overridable for tests. */
  client?: Pick<SQSClient, 'send'>;
}

export type RawSqsHandler = (body: string, meta: { messageId?: string }) => Promise<void>;

const MAX_BACKOFF_MS = 60_000;

export class SqsPoller {
  private readonly logger = new Logger(SqsPoller.name);
  private readonly client: Pick<SQSClient, 'send'>;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;

  constructor(
    private readonly options: SqsPollerOptions,
    private readonly handler: RawSqsHandler,
  ) {
    this.client =
      options.client ??
      new SQSClient({
        region: options.region,
        ...(options.endpoint && {
          endpoint: options.endpoint,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }),
      });
  }

  get queueUrl(): string {
    return this.options.queueUrl;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.log(`Polling ${this.options.queueUrl}`);
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** One receive + dispatch round; exported so tests drive it without the loop. */
  async pollOnce(): Promise<number> {
    const res = (await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: this.options.maxMessages ?? 10,
        WaitTimeSeconds: this.options.waitTimeSeconds ?? 20,
      }),
    )) as { Messages?: Message[] };
    const messages = res.Messages ?? [];
    for (const message of messages) await this.process(message);
    return messages.length;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
        this.consecutiveErrors = 0;
      } catch (error) {
        this.consecutiveErrors++;
        const backoff = Math.min(1000 * 2 ** (this.consecutiveErrors - 1), MAX_BACKOFF_MS);
        if (this.consecutiveErrors <= 3) {
          this.logger.error(`Poll error on ${this.options.queueUrl}: ${error instanceof Error ? error.message : error}`);
        } else if (this.consecutiveErrors === 4) {
          this.logger.warn(`SQS poll failing repeatedly; backing off to ${backoff / 1000}s and going quiet`);
        }
        if (this.running) await this.sleep(backoff);
        continue;
      }
      if (this.running) await this.sleep(100);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.timer = setTimeout(resolve, ms);
    });
  }

  private async process(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;
    try {
      await this.handler(message.Body, { messageId: message.MessageId });
    } catch (error) {
      // Left on the queue on purpose: redelivered after the visibility timeout, DLQ after 5.
      this.logger.error(
        `Handler failed for ${message.MessageId ?? '?'} (left for redelivery): ${error instanceof Error ? error.message : error}`,
      );
      return;
    }
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.options.queueUrl, ReceiptHandle: message.ReceiptHandle }),
    );
  }
}

/**
 * The SQS body, unwrapped: SNS raw delivery hands the notification JSON
 * itself; without raw delivery it is `{ Type: 'Notification', Message }`.
 * `null` when the body is not JSON at all.
 */
export function parseSqsBody(body: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object' && (parsed as { Type?: string }).Type === 'Notification') {
    const inner = (parsed as { Message?: unknown }).Message;
    if (typeof inner === 'string') {
      try {
        return JSON.parse(inner);
      } catch {
        return null;
      }
    }
    return inner ?? null;
  }
  return parsed;
}
