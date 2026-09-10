import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import {
  Probe,
  ProbeKind,
  ProbeOutcome,
  ProbeResourceStatus,
} from '../connectivity.types';

export class SqsProbe implements Probe {
  readonly name = 'sqs';
  readonly kind: ProbeKind = 'sqs';

  constructor(
    private readonly client: SQSClient,
    private readonly queues: string[],
  ) {}

  async run(): Promise<ProbeOutcome> {
    // GetQueueAttributes, not GetQueueUrl, for two reasons. Configuration hands
    // us queue URLs while GetQueueUrl takes a queue *name*, and no consuming
    // task role grants sqs:GetQueueUrl — they grant ReceiveMessage,
    // DeleteMessage and GetQueueAttributes, which is exactly what the consumer
    // needs. AWS reports that denial as QueueDoesNotExist, so the probe claimed
    // a missing queue for one the service was consuming from quite happily.
    const resources: ProbeResourceStatus[] = await Promise.all(
      this.queues.map(async (queue) => {
        try {
          await this.client.send(
            new GetQueueAttributesCommand({
              QueueUrl: queue,
              AttributeNames: ['QueueArn'],
            }),
          );
          return { resource: queue, present: true };
        } catch (err) {
          const detail =
            (err as { name?: string; message?: string })?.name ??
            (err as Error)?.message;
          return { resource: queue, present: false, details: detail };
        }
      }),
    );
    const present = resources.filter((r) => r.present).length;
    return {
      ok: present === resources.length,
      message: `${present}/${resources.length} queues found`,
      resources,
    };
  }
}
