import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CALL_FLOW_LIMITS, type CallFlowAudio } from '@bitcrm/types';

const BUCKET = process.env.S3_BUCKET || process.env.APP_BUCKET || '';
const PREFIX = 'call-flows/audio';

/** What Twilio will actually play. Anything else is a silent greeting. */
const ALLOWED = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);

/**
 * Recorded greetings.
 *
 * Kept in the shared app bucket and served back through our own public
 * endpoint rather than a presigned URL: Twilio fetches the audio itself, at
 * call time, possibly months after the flow was saved — a URL that expires
 * would turn into a silent greeting nobody notices until a customer does.
 */
@Injectable()
export class FlowAudioService {
  private readonly logger = new Logger(FlowAudioService.name);
  private readonly s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.AWS_ENDPOINT && {
      endpoint: process.env.AWS_ENDPOINT,
      forcePathStyle: true,
    }),
  });

  private key(id: string): string {
    return `${PREFIX}/${id}`;
  }

  async upload(
    file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
    caller: { id: string },
  ): Promise<CallFlowAudio> {
    if (!BUCKET) {
      throw new BadRequestException('No storage bucket is configured for audio');
    }
    const contentType = (file.mimetype ?? '').toLowerCase();
    if (!ALLOWED.has(contentType)) {
      throw new BadRequestException(
        'Upload an MP3 or WAV file — Twilio cannot play other formats',
      );
    }
    const size = file.size ?? file.buffer.length;
    if (size > CALL_FLOW_LIMITS.maxAudioBytes) {
      throw new BadRequestException(
        `That file is too large — greetings are capped at ${
          CALL_FLOW_LIMITS.maxAudioBytes / (1024 * 1024)
        } MB`,
      );
    }

    const id = randomUUID();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: this.key(id),
        Body: file.buffer,
        ContentType: contentType,
        Metadata: { uploadedBy: caller.id },
      }),
    );
    this.logger.log(`Uploaded flow audio ${id} (${size} bytes)`);

    return {
      id,
      name: file.originalname ?? 'greeting',
      contentType,
      sizeBytes: size,
      uploadedBy: caller.id,
      uploadedAt: new Date().toISOString(),
    };
  }

  /** The bytes, for the public endpoint Twilio fetches. */
  async read(
    id: string,
  ): Promise<{ body: NodeJS.ReadableStream; contentType: string } | null> {
    if (!BUCKET) return null;
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: this.key(id) }),
      );
      return {
        body: result.Body as unknown as NodeJS.ReadableStream,
        contentType: result.ContentType ?? 'audio/mpeg',
      };
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    if (!BUCKET) return;
    await this.s3
      .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: this.key(id) }))
      .catch(() => undefined);
  }
}
