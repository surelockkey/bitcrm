import { SqsProbe } from '../../../../src/connectivity/probes/sqs.probe';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetQueueAttributesCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

const QUEUE =
  'https://sqs.us-east-1.amazonaws.com/000000000000/bitcrm-dev-search-index';

describe('SqsProbe', () => {
  let client: SQSClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SQSClient({});
  });

  it('returns ok when all queues are reachable', async () => {
    mockSend.mockResolvedValue({ Attributes: { QueueArn: 'arn:aws:sqs:...' } });
    const probe = new SqsProbe(client, [QUEUE]);

    expect((await probe.run()).ok).toBe(true);
  });

  /**
   * Configuration gives us queue *URLs*, and GetQueueUrl takes a queue *name* —
   * so the old call was wrong twice over. GetQueueAttributes takes the URL we
   * actually hold, and it is an action every consuming task role already grants;
   * GetQueueUrl is not, and AWS reports that denial as QueueDoesNotExist, which
   * had search-service and deal-service reporting a missing queue they were
   * consuming from perfectly well.
   */
  it('identifies the queue by URL, not by name', async () => {
    mockSend.mockResolvedValue({ Attributes: {} });
    const probe = new SqsProbe(client, [QUEUE]);

    await probe.run();

    expect(GetQueueAttributesCommand).toHaveBeenCalledWith(
      expect.objectContaining({ QueueUrl: QUEUE }),
    );
  });

  it('asks only for an attribute every consumer role can read', async () => {
    mockSend.mockResolvedValue({ Attributes: {} });
    const probe = new SqsProbe(client, [QUEUE]);

    await probe.run();

    expect(GetQueueAttributesCommand).toHaveBeenCalledWith(
      expect.objectContaining({ AttributeNames: ['QueueArn'] }),
    );
  });

  it('returns ok=false and names the queue that failed', async () => {
    mockSend
      .mockResolvedValueOnce({ Attributes: {} })
      .mockRejectedValueOnce(
        Object.assign(new Error('does not exist'), {
          name: 'AWS.SimpleQueueService.NonExistentQueue',
        }),
      );
    const probe = new SqsProbe(client, [QUEUE, 'missing']);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: QUEUE, present: true },
      {
        resource: 'missing',
        present: false,
        details: 'AWS.SimpleQueueService.NonExistentQueue',
      },
    ]);
  });

  it('treats an empty queue list as ok', async () => {
    const probe = new SqsProbe(client, []);
    expect((await probe.run()).ok).toBe(true);
  });
});
