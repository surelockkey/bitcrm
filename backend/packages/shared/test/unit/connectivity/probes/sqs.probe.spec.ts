import { SqsProbe } from '../../../../src/connectivity/probes/sqs.probe';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetQueueUrlCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { SQSClient } from '@aws-sdk/client-sqs';

describe('SqsProbe', () => {
  let client: SQSClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SQSClient({});
  });

  it('returns ok when all queues exist', async () => {
    mockSend.mockResolvedValue({ QueueUrl: 'http://localhost/q' });
    const probe = new SqsProbe(client, ['a', 'b']);

    const out = await probe.run();

    expect(out.ok).toBe(true);
  });

  it('returns ok=false when a queue lookup fails', async () => {
    mockSend
      .mockResolvedValueOnce({ QueueUrl: 'http://localhost/a' })
      .mockRejectedValueOnce(
        Object.assign(new Error('does not exist'), {
          name: 'QueueDoesNotExist',
        }),
      );
    const probe = new SqsProbe(client, ['a', 'missing']);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: 'a', present: true },
      { resource: 'missing', present: false, details: 'QueueDoesNotExist' },
    ]);
  });
});
