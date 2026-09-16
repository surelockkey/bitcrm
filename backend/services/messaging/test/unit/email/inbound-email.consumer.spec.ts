import { InboundEmailConsumer, locationsOf } from '../../../src/email/inbound/inbound-email.consumer';

const sesNotification = {
  notificationType: 'Received',
  mail: { messageId: 'ses-in-1', timestamp: '2026-09-15T10:05:30.000Z', source: 'jane@example.com', destination: ['c-x@reply.example.com'] },
  receipt: {
    recipients: ['c-x@reply.example.com'],
    spamVerdict: { status: 'PASS' },
    virusVerdict: { status: 'PASS' },
    action: { type: 'S3', bucketName: 'bitcrm-dev-app', objectKeyPrefix: 'messaging/inbound-email/', objectKey: 'messaging/inbound-email/ses-in-1', topicArn: 'arn' },
  },
};

const s3Event = {
  Records: [
    { eventSource: 'aws:s3', s3: { bucket: { name: 'bitcrm-dev-app' }, object: { key: 'messaging/inbound-email/with+space%2Bplus' } } },
    { eventSource: 'aws:s3', s3: { bucket: { name: 'bitcrm-dev-app' } } },
  ],
};

describe('locationsOf', () => {
  it('reads the SES Received notification with its verdicts and recipients', () => {
    expect(locationsOf(sesNotification)).toEqual([
      {
        bucket: 'bitcrm-dev-app',
        key: 'messaging/inbound-email/ses-in-1',
        sesMessageId: 'ses-in-1',
        recipients: ['c-x@reply.example.com'],
        receivedAt: '2026-09-15T10:05:30.000Z',
        spamVerdict: 'PASS',
        virusVerdict: 'PASS',
      },
    ]);
  });

  it('reads S3 ObjectCreated records, URL-decoding the key, skipping records without one', () => {
    expect(locationsOf(s3Event)).toEqual([{ bucket: 'bitcrm-dev-app', key: 'messaging/inbound-email/with space+plus' }]);
  });

  it('answers nothing for other shapes', () => {
    expect(locationsOf({ notificationType: 'Received', receipt: { action: { type: 'SNS' } } })).toEqual([]);
    expect(locationsOf({ eventType: 'Delivery' })).toEqual([]);
    expect(locationsOf(null)).toEqual([]);
    expect(locationsOf('x')).toEqual([]);
  });
});

describe('InboundEmailConsumer.handle', () => {
  function make() {
    const ingest = jest.fn(async () => ({ outcome: 'stored' as const, conversationId: 'c1', conversationCreated: false, attachmentsStored: 0 }));
    const metrics = { sqsMessagesProcessed: { inc: jest.fn() } };
    return { consumer: new InboundEmailConsumer({ ingest } as any, metrics as any), ingest, metrics };
  }

  it('runs each located mail through the pipeline, unwrapping an SNS envelope', async () => {
    const { consumer, ingest, metrics } = make();
    await consumer.handle(JSON.stringify(sesNotification));
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'bitcrm-dev-app', key: 'messaging/inbound-email/ses-in-1', sesMessageId: 'ses-in-1' }));
    await consumer.handle(JSON.stringify({ Type: 'Notification', Message: JSON.stringify(s3Event) }));
    expect(ingest).toHaveBeenLastCalledWith({ bucket: 'bitcrm-dev-app', key: 'messaging/inbound-email/with space+plus' });
    expect(metrics.sqsMessagesProcessed.inc).toHaveBeenCalledWith({ event_type: 'ses.inbound', status: 'stored' });
  });

  it('drops a body that points at no object, counting it, instead of retrying it forever', async () => {
    const { consumer, ingest, metrics } = make();
    await consumer.handle('not json');
    await consumer.handle(JSON.stringify({ eventType: 'Delivery' }));
    expect(ingest).not.toHaveBeenCalled();
    expect(metrics.sqsMessagesProcessed.inc).toHaveBeenCalledWith({ event_type: 'ses.inbound', status: 'dropped' });
  });

  it('lets a pipeline failure propagate so SQS redelivers', async () => {
    const { consumer, ingest } = make();
    ingest.mockRejectedValueOnce(new Error('dynamo down'));
    await expect(consumer.handle(JSON.stringify(sesNotification))).rejects.toThrow('dynamo down');
  });
});
