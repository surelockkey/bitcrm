import { Injectable, Logger } from '@nestjs/common';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { PublisherOptions, EventMessage } from './events.interfaces';
import { getTraceId } from '../logger/trace-storage';
import { TRACE_ID_ATTRIBUTE } from '../logger/logger.constants';

@Injectable()
export class SnsPublisherService {
  private readonly logger = new Logger(SnsPublisherService.name);
  private readonly client: SNSClient;
  private readonly topicArns: Record<string, string>;
  private readonly source: string;

  constructor(options: PublisherOptions, source = 'unknown-service') {
    this.client = new SNSClient({
      region: options.region || 'us-east-1',
      ...(options.endpoint && {
        endpoint: options.endpoint,
        credentials: options.credentials || {
          accessKeyId: 'local',
          secretAccessKey: 'local',
        },
      }),
    });
    this.topicArns = options.topicArns || {};
    this.source = source;
  }

  async publish<T>(
    topicName: string,
    eventType: string,
    payload: T,
  ): Promise<void> {
    const topicArn = this.topicArns[topicName];
    if (!topicArn) {
      throw new Error(`Topic ARN not configured for "${topicName}"`);
    }

    const message: EventMessage<T> = {
      eventType,
      timestamp: new Date().toISOString(),
      source: this.source,
      payload,
    };

    const traceId = getTraceId();
    const messageAttributes: Record<string, { DataType: string; StringValue: string }> = {
      eventType: {
        DataType: 'String',
        StringValue: eventType,
      },
    };
    if (traceId) {
      messageAttributes[TRACE_ID_ATTRIBUTE] = {
        DataType: 'String',
        StringValue: traceId,
      };
    }

    const result = await this.client.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify(message),
        MessageAttributes: messageAttributes,
      }),
    );

    this.logger.log(
      `Published ${eventType} to ${topicName} (MessageId: ${result.MessageId})`,
    );
  }
}
