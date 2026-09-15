import { MediaQueueService } from '../../../src/media/media-queue.service';
import { INBOUND_REPLAY_JOB, MEDIA_COPY_JOB } from '../../../src/media/media.jobs';

const job = {
  conversationId: 'c1',
  messageId: 'm1',
  createdAt: '2026-09-15T10:05:00.000Z',
  providerSid: 'MM1',
  attachments: [{ id: 'a1', sourceUrl: 'https://api.twilio.com/x', contentType: 'image/jpeg', providerMediaSid: 'ME1' }],
};

describe('MediaQueueService', () => {
  it('is a logged no-op without MESSAGING_MEDIA_QUEUE_URL', async () => {
    const service = new MediaQueueService({ queueUrl: undefined, client: { send: jest.fn() } });
    expect(service.enabled).toBe(false);
    expect(await service.enqueueMediaCopy(job)).toBe(false);
    expect(await service.enqueueInboundReplay({ payload: {}, capturedAt: 'x' })).toBe(false);
  });

  it('sends the job in the EventMessage envelope the shared consumer dispatches on', async () => {
    const send = jest.fn().mockResolvedValue({ MessageId: 'x' });
    const service = new MediaQueueService({ queueUrl: 'https://sqs/media', client: { send } });
    expect(service.enabled).toBe(true);

    expect(await service.enqueueMediaCopy(job)).toBe(true);
    const cmd = send.mock.calls[0][0];
    expect(cmd.constructor.name).toBe('SendMessageCommand');
    expect(cmd.input.QueueUrl).toBe('https://sqs/media');
    const body = JSON.parse(cmd.input.MessageBody);
    expect(body).toMatchObject({ eventType: MEDIA_COPY_JOB, source: 'messaging-service', payload: job });
    expect(typeof body.timestamp).toBe('string');

    await service.enqueueInboundReplay({ s3Key: 'k', payload: { MessageSid: 'SM1' }, capturedAt: 'x' });
    expect(JSON.parse(send.mock.calls[1][0].input.MessageBody)).toMatchObject({
      eventType: INBOUND_REPLAY_JOB,
      payload: { s3Key: 'k', payload: { MessageSid: 'SM1' }, capturedAt: 'x' },
    });
  });

  it('lets an SQS failure surface to the caller', async () => {
    const send = jest.fn().mockRejectedValue(new Error('SQS down'));
    const service = new MediaQueueService({ queueUrl: 'https://sqs/media', client: { send } });
    await expect(service.enqueueMediaCopy(job)).rejects.toThrow('SQS down');
  });
});
