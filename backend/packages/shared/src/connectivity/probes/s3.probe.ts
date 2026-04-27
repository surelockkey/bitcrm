import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  Probe,
  ProbeKind,
  ProbeOutcome,
  ProbeResourceStatus,
} from '../connectivity.types';

export class S3Probe implements Probe {
  readonly name = 's3';
  readonly kind: ProbeKind = 's3';

  constructor(
    private readonly client: S3Client,
    private readonly buckets: string[],
  ) {}

  async run(): Promise<ProbeOutcome> {
    const resources: ProbeResourceStatus[] = await Promise.all(
      this.buckets.map(async (bucket) => {
        try {
          await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
          return { resource: bucket, present: true };
        } catch (err) {
          const detail =
            (err as { name?: string; message?: string })?.name ??
            (err as Error)?.message;
          return { resource: bucket, present: false, details: detail };
        }
      }),
    );
    const present = resources.filter((r) => r.present).length;
    return {
      ok: present === resources.length,
      message: `${present}/${resources.length} buckets accessible`,
      resources,
    };
  }
}
