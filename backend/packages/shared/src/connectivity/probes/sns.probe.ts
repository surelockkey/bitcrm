import { SNSClient, GetTopicAttributesCommand } from '@aws-sdk/client-sns';
import {
  Probe,
  ProbeKind,
  ProbeOutcome,
  ProbeResourceStatus,
} from '../connectivity.types';

export class SnsProbe implements Probe {
  readonly name = 'sns';
  readonly kind: ProbeKind = 'sns';

  constructor(
    private readonly client: SNSClient,
    private readonly requiredTopics: string[],
  ) {}

  async run(): Promise<ProbeOutcome> {
    // GetTopicAttributes on each known topic ARN rather than ListTopics: the
    // latter needs account-wide sns:ListTopics on resource "*", which breaks
    // per-service least-privilege. Scoped to the topic the service publishes
    // to (mirrors S3/SQS probes).
    const resources: ProbeResourceStatus[] = await Promise.all(
      this.requiredTopics.map(async (topic) => {
        try {
          await this.client.send(
            new GetTopicAttributesCommand({ TopicArn: topic }),
          );
          return { resource: topic, present: true };
        } catch (err) {
          const detail =
            (err as { name?: string; message?: string })?.name ??
            (err as Error)?.message;
          return { resource: topic, present: false, details: detail };
        }
      }),
    );
    const present = resources.filter((r) => r.present).length;
    return {
      ok: resources.length === 0 ? true : present === resources.length,
      message: `${present}/${resources.length} topics accessible`,
      resources,
    };
  }
}
