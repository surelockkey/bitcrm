import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignedUploadOptions {
  contentType: string;
  expiresIn?: number;
  /** When set, the upload is forced to use SSE-KMS with this key. */
  kmsKeyId?: string;
}

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket =
      process.env.DOCUMENTS_BUCKET || process.env.S3_BUCKET || 'bitcrm-uploads';
    this.client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ENDPOINT && {
        endpoint: process.env.AWS_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        forcePathStyle: true,
      }),
    });
  }

  /**
   * A presigned PUT URL **plus the exact headers the client must send with it.**
   *
   * For an SSE-KMS upload the encryption headers are part of the signature, so a
   * client that PUTs with only `Content-Type` gets a 403 (SignatureDoesNotMatch).
   * Returning the headers here means the caller physically can't forget them —
   * the header set and the signature are produced from the same options.
   */
  async getPresignedUpload(
    key: string,
    opts: PresignedUploadOptions,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const headers: Record<string, string> = { 'Content-Type': opts.contentType };
    if (opts.kmsKeyId) {
      headers['x-amz-server-side-encryption'] = 'aws:kms';
      headers['x-amz-server-side-encryption-aws-kms-key-id'] = opts.kmsKeyId;
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ...(opts.kmsKeyId && {
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: opts.kmsKeyId,
      }),
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: opts.expiresIn ?? 300,
      ...(opts.kmsKeyId && {
        signableHeaders: new Set([
          'x-amz-server-side-encryption',
          'x-amz-server-side-encryption-aws-kms-key-id',
        ]),
      }),
    });
    return { url, headers };
  }

  async getPresignedUploadUrl(
    key: string,
    contentTypeOrOpts: string | PresignedUploadOptions,
    expiresIn = 300,
  ): Promise<string> {
    const opts: PresignedUploadOptions =
      typeof contentTypeOrOpts === 'string'
        ? { contentType: contentTypeOrOpts, expiresIn }
        : contentTypeOrOpts;

    const { url } = await this.getPresignedUpload(key, opts);
    return url;
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
