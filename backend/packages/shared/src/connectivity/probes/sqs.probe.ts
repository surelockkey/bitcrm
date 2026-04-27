import { SQSClient, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
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
    const resources: ProbeResourceStatus[] = await Promise.all(
      this.queues.map(async (queue) => {
        try {
          await this.client.send(new GetQueueUrlCommand({ QueueName: queue }));
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
