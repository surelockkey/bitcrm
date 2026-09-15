/**
 * Everything the outbound path reads from the environment, resolved once at
 * module init and injected under `OUTBOUND_CONFIG` (the `TWILIO_CONFIG`
 * habit: services never touch `process.env`, tests hand in a literal).
 */
export interface OutboundConfig {
  /** `MESSAGING_OUTBOUND_QUEUE_URL` — the FIFO queue between accept and send. Unset → the worker runs in-process. */
  queueUrl?: string;
  awsRegion: string;
  awsEndpoint?: string;
  /** `MESSAGING_DEFAULT_SENDER` — rung 6 of the sender chain when settings carry none. */
  defaultSender?: string;
  /** `ENABLE_SQS_CONSUMER=true` — poll the outbound queue (off in local dev without LocalStack). */
  consumerEnabled: boolean;
  /** Lifetime of the presigned GET URLs handed to Twilio as `mediaUrl` (design §4.6: 1 h). */
  mediaUrlTtlSeconds: number;
  /** Lifetime of the presigned PUT URL handed to the composer. */
  uploadUrlTtlSeconds: number;
  /** `DOCUMENTS_KMS_KEY_ID` — SSE-KMS key for uploads, as deal attachments use. */
  kmsKeyId?: string;
}

export const OUTBOUND_CONFIG = Symbol('OUTBOUND_CONFIG');

export const OUTBOUND_ENV_VARS = [
  'MESSAGING_OUTBOUND_QUEUE_URL',
  'MESSAGING_DEFAULT_SENDER',
  'ENABLE_SQS_CONSUMER',
  'AWS_REGION',
  'AWS_ENDPOINT',
  'DOCUMENTS_KMS_KEY_ID',
  'MESSAGING_MEDIA_URL_TTL_SECONDS',
] as const;

export function loadOutboundConfig(env: NodeJS.ProcessEnv = process.env): OutboundConfig {
  return {
    queueUrl: env.MESSAGING_OUTBOUND_QUEUE_URL || undefined,
    awsRegion: env.AWS_REGION || 'us-east-1',
    awsEndpoint: env.AWS_ENDPOINT || undefined,
    defaultSender: env.MESSAGING_DEFAULT_SENDER || undefined,
    consumerEnabled: env.ENABLE_SQS_CONSUMER === 'true',
    mediaUrlTtlSeconds: Number(env.MESSAGING_MEDIA_URL_TTL_SECONDS) || 3600,
    uploadUrlTtlSeconds: 300,
    kmsKeyId: env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents',
  };
}
