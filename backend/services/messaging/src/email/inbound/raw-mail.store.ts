import { Inject, Injectable, Optional } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { EMAIL_CONFIG, type EmailConfig } from '../email.config';

/** `S3Client`, narrowed so tests hand in a recorder. */
export interface RawMailS3Api {
  send(command: GetObjectCommand): Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }>;
}

export const RAW_MAIL_S3_CLIENT = Symbol('RAW_MAIL_S3_CLIENT');

/**
 * Reads the raw mail the SES receipt rule wrote to S3
 * (`messaging/inbound-email/<sesMessageId>` in the documents bucket). The
 * shared `S3Service` only writes and presigns, and the notification names
 * the bucket explicitly, so this keeps its own read-only client.
 */
@Injectable()
export class RawMailStore {
  private readonly client: RawMailS3Api;

  constructor(
    @Inject(EMAIL_CONFIG) config: Pick<EmailConfig, 'awsRegion' | 'awsEndpoint'>,
    @Optional() @Inject(RAW_MAIL_S3_CLIENT) client?: RawMailS3Api,
  ) {
    this.client =
      client ??
      new S3Client({
        region: config.awsRegion,
        ...(config.awsEndpoint && {
          endpoint: config.awsEndpoint,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          forcePathStyle: true,
        }),
      });
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`s3://${bucket}/${key} has no body`);
    return Buffer.from(await res.Body.transformToByteArray());
  }
}
