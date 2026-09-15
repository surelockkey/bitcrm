import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { SqsPoller, parseSqsBody } from '../../../src/email/sqs-poller';

function make(batches: Array<Array<{ MessageId: string; Body: string; ReceiptHandle: string }>>, handler: jest.Mock) {
  let i = 0;
  const client = {
    send: jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ReceiveMessageCommand) return { Messages: batches[i++] ?? [] };
      return {};
    }),
  };
  const poller = new SqsPoller({ queueUrl: 'https://sqs/q', region: 'us-east-1', client: client as any, waitTimeSeconds: 1, maxMessages: 5 }, handler);
  return { poller, client };
}

describe('SqsPoller', () => {
  it('long-polls the queue, hands each raw body to the handler and deletes what it handled', async () => {
    const handler = jest.fn(async () => undefined);
    const { poller, client } = make([[{ MessageId: '1', Body: '{"a":1}', ReceiptHandle: 'r1' }, { MessageId: '2', Body: 'x', ReceiptHandle: 'r2' }]], handler);

    expect(await poller.pollOnce()).toBe(2);
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(ReceiveMessageCommand);
    expect((client.send.mock.calls[0][0] as ReceiveMessageCommand).input).toEqual({ QueueUrl: 'https://sqs/q', MaxNumberOfMessages: 5, WaitTimeSeconds: 1 });
    expect(handler).toHaveBeenNthCalledWith(1, '{"a":1}', { messageId: '1' });
    expect(handler).toHaveBeenNthCalledWith(2, 'x', { messageId: '2' });
    const deletes = client.send.mock.calls.map((c) => c[0]).filter((c) => c instanceof DeleteMessageCommand) as DeleteMessageCommand[];
    expect(deletes.map((d) => d.input.ReceiptHandle)).toEqual(['r1', 'r2']);
    expect(poller.queueUrl).toBe('https://sqs/q');
  });

  it('leaves a message on the queue when the handler throws (redelivery → DLQ)', async () => {
    const handler = jest.fn().mockRejectedValueOnce(new Error('retry me')).mockResolvedValueOnce(undefined);
    const { poller, client } = make([[{ MessageId: '1', Body: 'a', ReceiptHandle: 'r1' }, { MessageId: '2', Body: 'b', ReceiptHandle: 'r2' }]], handler);
    await poller.pollOnce();
    const deletes = client.send.mock.calls.map((c) => c[0]).filter((c) => c instanceof DeleteMessageCommand) as DeleteMessageCommand[];
    expect(deletes.map((d) => d.input.ReceiptHandle)).toEqual(['r2']);
  });

  it('start/stop drive the loop and are idempotent', async () => {
    const handler = jest.fn(async () => undefined);
    const { poller, client } = make([[{ MessageId: '1', Body: 'a', ReceiptHandle: 'r1' }]], handler);
    poller.start();
    poller.start();
    await new Promise((r) => setTimeout(r, 20));
    poller.stop();
    poller.stop();
    expect(handler).toHaveBeenCalledWith('a', { messageId: '1' });
    expect(client.send).toHaveBeenCalled();
  });
});

describe('parseSqsBody', () => {
  it('returns the JSON as-is for raw delivery, unwraps an SNS Notification, null for garbage', () => {
    expect(parseSqsBody('{"eventType":"Send"}')).toEqual({ eventType: 'Send' });
    expect(parseSqsBody(JSON.stringify({ Type: 'Notification', Message: '{"eventType":"Delivery"}' }))).toEqual({ eventType: 'Delivery' });
    expect(parseSqsBody(JSON.stringify({ Type: 'Notification', Message: 'nope{' }))).toBeNull();
    expect(parseSqsBody(JSON.stringify({ Type: 'Notification' }))).toBeNull();
    expect(parseSqsBody('not json')).toBeNull();
  });
});
