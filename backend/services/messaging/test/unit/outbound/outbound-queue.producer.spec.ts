import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { OUTBOUND_JOB_EVENT, OutboundQueueProducer } from '../../../src/outbound/outbound-queue.producer';
import { T1 } from '../mocks';

const job = { conversationId: 'c1', createdAt: T1, messageId: 'm2' };
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('OutboundQueueProducer', () => {
  it('sends a FIFO message grouped by conversation and deduplicated by message id', async () => {
    const client = { send: jest.fn(async (_cmd: SendMessageCommand) => ({})) };
    const producer = new OutboundQueueProducer(
      { queueUrl: 'https://sqs/messaging-outbound.fifo', awsRegion: 'us-east-1' },
      client,
    );

    expect(producer.configured).toBe(true);
    expect(await producer.enqueue(job)).toBe('queued');

    const cmd = client.send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(SendMessageCommand);
    expect(cmd.input).toMatchObject({
      QueueUrl: 'https://sqs/messaging-outbound.fifo',
      MessageGroupId: 'c1',
      MessageDeduplicationId: 'm2',
    });
    expect(JSON.parse(cmd.input.MessageBody!)).toMatchObject({
      eventType: OUTBOUND_JOB_EVENT,
      source: 'messaging-service',
      payload: job,
    });
  });

  it('propagates an SQS failure so the caller can mark the message failed', async () => {
    const client = { send: jest.fn(async () => { throw new Error('sqs down'); }) };
    const producer = new OutboundQueueProducer({ queueUrl: 'https://sqs/q.fifo', awsRegion: 'us-east-1' }, client);
    await expect(producer.enqueue(job)).rejects.toThrow('sqs down');
  });

  it('hands the job to the in-process worker when no queue is configured', async () => {
    const producer = new OutboundQueueProducer({ awsRegion: 'us-east-1' });
    const handler = jest.fn(async () => undefined);
    producer.setInlineHandler(handler);

    expect(producer.configured).toBe(false);
    expect(await producer.enqueue(job)).toBe('inline');
    expect(handler).not.toHaveBeenCalled(); // next tick, never inside the request
    await flush();
    expect(handler).toHaveBeenCalledWith(job);
  });

  it('reports a dropped job when neither a queue nor a worker exists', async () => {
    const producer = new OutboundQueueProducer({ awsRegion: 'us-east-1' });
    expect(await producer.enqueue(job)).toBe('dropped');
  });
});
