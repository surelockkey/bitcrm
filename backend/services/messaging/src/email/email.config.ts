/**
 * Everything the email path reads from the environment (design §5, M17/M18),
 * resolved once at module init and injected under `EMAIL_CONFIG` — the
 * `OUTBOUND_CONFIG` habit: services never touch `process.env`, tests hand in
 * a literal.
 *
 * Nothing here is required to boot. Without `MESSAGING_EMAIL_FROM` the send
 * path answers 501 for `channel: email`; without the queue URLs the SES event
 * and inbound-mail consumers are simply not constructed.
 */
export interface EmailConfig {
  /**
   * `MESSAGING_EMAIL_FROM` — the verified sender the workspace mails from
   * (`office@<domain>`). `MESSAGING#SETTINGS.companyEmail` wins when it is on
   * the same verified domain (`EmailAddressResolver`).
   */
  fromAddress?: string;
  /** `MESSAGING_EMAIL_DOMAIN` — the SES domain identity; only addresses on it may be a `From`. */
  domain?: string;
  /**
   * `MESSAGING_EMAIL_REPLY_DOMAIN` — the replies subdomain with the MX record
   * (`reply.<domain>`). `Reply-To: c-<conversationId>@<replyDomain>` threads an
   * answer back to its conversation. Unset → a plus-address on `fromAddress`.
   */
  replyDomain?: string;
  /** `SES_CONFIGURATION_SET` — carries the event destination (Send/Delivery/Bounce/…). */
  configurationSet?: string;
  /** `MESSAGING_EMAIL_EVENTS_QUEUE_URL` — SES events via SNS → this SQS queue. */
  eventsQueueUrl?: string;
  /** `MESSAGING_INBOUND_EMAIL_QUEUE_URL` — "a mail landed in S3" notifications. */
  inboundQueueUrl?: string;
  awsRegion: string;
  awsEndpoint?: string;
  /** `ENABLE_SQS_CONSUMER=true` — poll the two email queues. */
  consumerEnabled: boolean;
  /**
   * `MESSAGING_EMAIL_INLINE_ATTACHMENT_BYTES` — attachments up to this total
   * ride inside the mail as MIME parts; above it they are presigned links.
   * SES caps a raw message at 40 MB; 5 MB keeps mailboxes happy.
   */
  maxInlineAttachmentBytes: number;
  /** `MESSAGING_EMAIL_LINK_TTL_SECONDS` — lifetime of presigned attachment links (SigV4 max 7 days). */
  attachmentLinkTtlSeconds: number;
  /** `DOCUMENTS_KMS_KEY_ID` — SSE-KMS key for attachments copied out of inbound mail. */
  kmsKeyId?: string;
}

export const EMAIL_CONFIG = Symbol('EMAIL_CONFIG');

export const EMAIL_ENV_VARS = [
  'MESSAGING_EMAIL_FROM',
  'MESSAGING_EMAIL_DOMAIN',
  'MESSAGING_EMAIL_REPLY_DOMAIN',
  'SES_CONFIGURATION_SET',
  'MESSAGING_EMAIL_EVENTS_QUEUE_URL',
  'MESSAGING_INBOUND_EMAIL_QUEUE_URL',
  'MESSAGING_EMAIL_INLINE_ATTACHMENT_BYTES',
  'MESSAGING_EMAIL_LINK_TTL_SECONDS',
  'ENABLE_SQS_CONSUMER',
  'AWS_REGION',
  'AWS_ENDPOINT',
  'DOCUMENTS_KMS_KEY_ID',
] as const;

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const linkTtl = Number(env.MESSAGING_EMAIL_LINK_TTL_SECONDS);
  const inline = Number(env.MESSAGING_EMAIL_INLINE_ATTACHMENT_BYTES);
  return {
    fromAddress: env.MESSAGING_EMAIL_FROM?.trim().toLowerCase() || undefined,
    domain: env.MESSAGING_EMAIL_DOMAIN?.trim().toLowerCase() || undefined,
    replyDomain: env.MESSAGING_EMAIL_REPLY_DOMAIN?.trim().toLowerCase() || undefined,
    configurationSet: env.SES_CONFIGURATION_SET || undefined,
    eventsQueueUrl: env.MESSAGING_EMAIL_EVENTS_QUEUE_URL || undefined,
    inboundQueueUrl: env.MESSAGING_INBOUND_EMAIL_QUEUE_URL || undefined,
    awsRegion: env.AWS_REGION || 'us-east-1',
    awsEndpoint: env.AWS_ENDPOINT || undefined,
    consumerEnabled: env.ENABLE_SQS_CONSUMER === 'true',
    maxInlineAttachmentBytes: Number.isFinite(inline) && inline > 0 ? inline : 5 * 1024 * 1024,
    attachmentLinkTtlSeconds: Number.isFinite(linkTtl) && linkTtl > 0 ? Math.min(linkTtl, SEVEN_DAYS) : SEVEN_DAYS,
    kmsKeyId: env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents',
  };
}
