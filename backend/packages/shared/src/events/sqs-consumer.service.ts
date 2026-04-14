import { Injectable, Logger } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { ConsumerOptions, EventMessage } from './events.interfaces';
import { storage } from '../logger/trace-storage';
import { TRACE_ID_ATTRIBUTE } from '../logger/logger.constants';

@Injectable()
export class SqsConsumerService {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly waitTimeSeconds: number;
  private readonly maxMessages: number;
  private readonly handlers = new Map<string, (payload: unknown) => Promise<void>>();
  private running = false;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;
  private static readonly MAX_BACKOFF_MS = 60_000;

  constructor(options: ConsumerOptions) {
    this.client = new SQSClient({
      region: options.region || 'us-east-1',
      ...(options.endpoint && {
        endpoint: options.endpoint,
        credentials: options.credentials || {
          accessKeyId: 'local',
          secretAccessKey: 'local',
        },
      }),
    });
    this.queueUrl = options.queueUrl;
    this.waitTimeSeconds = options.waitTimeSeconds ?? 20;
    this.maxMessages = options.maxMessages ?? 10;
  }

  registerHandler(
    eventType: string,
    handler: (payload: unknown) => Promise<void>,
  ): void {
    this.handlers.set(eventType, handler);
    this.logger.log(`Registered handler for "${eventType}"`);
  }

  getHandlers(): Map<string, (payload: unknown) => Promise<void>> {
    return this.handlers;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.log(`Starting SQS consumer for ${this.queueUrl}`);
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  async pollOnce(): Promise<void> {
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: this.maxMessages,
        WaitTimeSeconds: this.waitTimeSeconds,
      }),
    );

    const messages = result.Messages || [];
    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
        this.consecutiveErrors = 0;
      } catch (error) {
        this.consecutiveErrors++;
        const backoff = Math.min(
          1000 * Math.pow(2, this.consecutiveErrors - 1),
          SqsConsumerService.MAX_BACKOFF_MS,
        );
        if (this.consecutiveErrors <= 3) {
          this.logger.error('Poll error:', error);
        } else if (this.consecutiveErrors === 4) {
          this.logger.warn(
            `SQS poll failing repeatedly (${this.consecutiveErrors} errors). ` +
            `Is LocalStack running? Backing off to ${backoff / 1000}s. Suppressing further logs.`,
          );
        }
        // Back off exponentially
        if (this.running) {
          await new Promise<void>((resolve) => {
            this.pollTimeout = setTimeout(resolve, backoff);
          });
        }
        continue;
      }

      if (this.running) {
        await new Promise<void>((resolve) => {
          this.pollTimeout = setTimeout(resolve, 100);
        });
      }
    }
  }

  private async processMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;

    // Extract traceId from SNS message attributes (propagated via SNS → SQS)
    const traceId = this.extractTraceId(message) || message.MessageId || 'unknown';

    // Run the handler within the trace context so all logs get the traceId
    await storage.run(traceId, async () => {
      try {
        const eventMessage = this.parseMessage(message.Body!);
        if (!eventMessage) {
          await this.deleteMessage(message.ReceiptHandle!);
          return;
        }

        const handler = this.handlers.get(eventMessage.eventType);
        if (!handler) {
          this.logger.warn(
            `No handler for event type "${eventMessage.eventType}", deleting message`,
          );
          await this.deleteMessage(message.ReceiptHandle!);
          return;
        }

        await handler(eventMessage.payload);
        await this.deleteMessage(message.ReceiptHandle!);
        this.logger.log(
          `Processed ${eventMessage.eventType} (MessageId: ${message.MessageId})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to process message ${message.MessageId}:`,
          error,
        );
        // Do NOT delete — SQS will retry, then send to DLQ
      }
    });
  }

  private extractTraceId(message: Message): string | undefined {
    // When SNS forwards to SQS, message attributes are nested in the body
    try {
      const body = JSON.parse(message.Body || '{}');
      if (body.MessageAttributes?.[TRACE_ID_ATTRIBUTE]?.Value) {
        return body.MessageAttributes[TRACE_ID_ATTRIBUTE].Value;
      }
    } catch {
      // Ignore parse errors — traceId is best-effort
    }
    return undefined;
  }

  private parseMessage(body: string): EventMessage | null {
    try {
      const parsed = JSON.parse(body);

      // Handle SNS-wrapped messages
      if (parsed.Type === 'Notification' && parsed.Message) {
        return JSON.parse(parsed.Message) as EventMessage;
      }

      // Direct message
      if (parsed.eventType) {
        return parsed as EventMessage;
      }

      this.logger.warn('Unrecognized message format');
      return null;
    } catch {
      this.logger.error('Failed to parse message body');
      return null;
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}
