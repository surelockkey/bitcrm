import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignedUploadOptions {
  contentType: string;
  expiresIn?: number;
  /** When set, the upload is forced to use SSE-KMS with this key. */
  kmsKeyId?: string;
}

/** A server-side write (a worker copying a file in), as opposed to a presigned browser PUT. */
export interface PutObjectOptions {
  contentType: string;
  /** When set, the object is stored with SSE-KMS under this key. */
  kmsKeyId?: string;
  /** Free-form `x-amz-meta-*` pairs (provenance: source URL, provider sid…). */
  metadata?: Record<string, string>;
}

/** Options for a presigned GET. */
export interface PresignedDownloadOptions {
  expiresIn?: number;
  /** Sets `response-content-disposition`, e.g. `attachment; filename="Invoice-1.pdf"`. */
  contentDisposition?: string;
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

  /**
   * Writes `body` straight from the service — what a queue worker does with a
   * file it fetched from a provider (inbound MMS media, a raw webhook
   * capture). Same SSE-KMS rule as the presigned uploads: pass `kmsKeyId` and
   * the object is encrypted under it, omit it and the bucket default applies.
   */
  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    opts: PutObjectOptions,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength,
        ...(opts.metadata && { Metadata: opts.metadata }),
        ...(opts.kmsKeyId && {
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: opts.kmsKeyId,
        }),
      }),
    );
  }

  /**
   * A presigned GET. The second argument is either the lifetime in seconds
   * (the original signature) or options that can also force a download
   * filename through `response-content-disposition`.
   */
  async getPresignedDownloadUrl(
    key: string,
    expiresInOrOpts: number | PresignedDownloadOptions = 3600,
  ): Promise<string> {
    const opts: PresignedDownloadOptions =
      typeof expiresInOrOpts === 'number' ? { expiresIn: expiresInOrOpts } : expiresInOrOpts;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(opts.contentDisposition && { ResponseContentDisposition: opts.contentDisposition }),
    });
    return getSignedUrl(this.client, command, { expiresIn: opts.expiresIn ?? 3600 });
  }

  /**
   * Reads a whole object into memory — for small server-side reads only
   * (template images inlined into a PDF). `null` when the key doesn't exist.
   */
  async getObjectBuffer(
    key: string,
  ): Promise<{ body: Buffer; contentType?: string } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) return null;
      const bytes = await body.transformToByteArray();
      return { body: Buffer.from(bytes), contentType: res.ContentType };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** True when the key exists (HEAD). */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  );
}
