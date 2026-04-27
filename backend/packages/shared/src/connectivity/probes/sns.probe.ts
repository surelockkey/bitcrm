import { SNSClient, ListTopicsCommand } from '@aws-sdk/client-sns';
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
    const all: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListTopicsCommand({ NextToken: token }),
      );
      if (res.Topics) {
        all.push(
          ...res.Topics.map((t) => t.TopicArn ?? '').filter(Boolean),
        );
      }
      token = res.NextToken;
    } while (token);

    const resources: ProbeResourceStatus[] = this.requiredTopics.map(
      (topic) => ({
        resource: topic,
        present: all.some((arn) => arn.endsWith(`:${topic}`)),
      }),
    );
    const present = resources.filter((r) => r.present).length;
    const ok = resources.length === 0 ? true : present === resources.length;

    return {
      ok,
      message:
        resources.length === 0
          ? `${all.length} topics`
          : `${all.length} topics, ${present}/${resources.length} required present`,
      resources,
    };
  }
}
