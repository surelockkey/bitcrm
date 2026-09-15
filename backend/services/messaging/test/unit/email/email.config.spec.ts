import { EMAIL_ENV_VARS, loadEmailConfig } from '../../../src/email/email.config';

describe('loadEmailConfig', () => {
  it('reads every documented variable, lower-casing the addresses and domains', () => {
    const cfg = loadEmailConfig({
      MESSAGING_EMAIL_FROM: ' Office@Example.COM ',
      MESSAGING_EMAIL_DOMAIN: 'Example.com',
      MESSAGING_EMAIL_REPLY_DOMAIN: 'Reply.Example.com',
      SES_CONFIGURATION_SET: 'bitcrm-dev-messaging',
      MESSAGING_EMAIL_EVENTS_QUEUE_URL: 'https://sqs/events',
      MESSAGING_INBOUND_EMAIL_QUEUE_URL: 'https://sqs/inbound',
      MESSAGING_EMAIL_INLINE_ATTACHMENT_BYTES: '1024',
      MESSAGING_EMAIL_LINK_TTL_SECONDS: '3600',
      ENABLE_SQS_CONSUMER: 'true',
      AWS_REGION: 'eu-west-1',
      AWS_ENDPOINT: 'http://localhost:4566',
      DOCUMENTS_KMS_KEY_ID: 'alias/docs',
    });
    expect(cfg).toEqual({
      fromAddress: 'office@example.com',
      domain: 'example.com',
      replyDomain: 'reply.example.com',
      configurationSet: 'bitcrm-dev-messaging',
      eventsQueueUrl: 'https://sqs/events',
      inboundQueueUrl: 'https://sqs/inbound',
      awsRegion: 'eu-west-1',
      awsEndpoint: 'http://localhost:4566',
      consumerEnabled: true,
      maxInlineAttachmentBytes: 1024,
      attachmentLinkTtlSeconds: 3600,
      kmsKeyId: 'alias/docs',
    });
    for (const name of EMAIL_ENV_VARS) expect(typeof name).toBe('string');
  });

  it('boots with nothing set: no sender, no queues, sane defaults', () => {
    const cfg = loadEmailConfig({});
    expect(cfg.fromAddress).toBeUndefined();
    expect(cfg.replyDomain).toBeUndefined();
    expect(cfg.eventsQueueUrl).toBeUndefined();
    expect(cfg.consumerEnabled).toBe(false);
    expect(cfg.awsRegion).toBe('us-east-1');
    expect(cfg.maxInlineAttachmentBytes).toBe(5 * 1024 * 1024);
    expect(cfg.attachmentLinkTtlSeconds).toBe(7 * 24 * 3600);
    expect(cfg.kmsKeyId).toBe('alias/bitcrm-documents');
  });

  it('caps the presigned link lifetime at the SigV4 maximum and ignores garbage numbers', () => {
    expect(loadEmailConfig({ MESSAGING_EMAIL_LINK_TTL_SECONDS: '99999999' }).attachmentLinkTtlSeconds).toBe(604800);
    expect(loadEmailConfig({ MESSAGING_EMAIL_INLINE_ATTACHMENT_BYTES: 'lots' }).maxInlineAttachmentBytes).toBe(5 * 1024 * 1024);
    expect(loadEmailConfig({ MESSAGING_EMAIL_INLINE_ATTACHMENT_BYTES: '0' }).maxInlineAttachmentBytes).toBe(5 * 1024 * 1024);
  });
});
