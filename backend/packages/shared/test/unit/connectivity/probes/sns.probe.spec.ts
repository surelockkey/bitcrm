import { SnsProbe } from '../../../../src/connectivity/probes/sns.probe';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  ListTopicsCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { SNSClient } from '@aws-sdk/client-sns';

describe('SnsProbe', () => {
  let client: SNSClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SNSClient({});
  });

  it('matches required topic names against ARNs by suffix', async () => {
    mockSend.mockResolvedValueOnce({
      Topics: [
        { TopicArn: 'arn:aws:sns:us-east-1:000000000000:bitcrm-deal-events' },
        { TopicArn: 'arn:aws:sns:us-east-1:000000000000:other' },
      ],
    });
    const probe = new SnsProbe(client, ['bitcrm-deal-events']);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.resources).toEqual([
      { resource: 'bitcrm-deal-events', present: true },
    ]);
  });

  it('reports missing required topics', async () => {
    mockSend.mockResolvedValueOnce({
      Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:000000000000:other' }],
    });
    const probe = new SnsProbe(client, ['bitcrm-deal-events']);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: 'bitcrm-deal-events', present: false },
    ]);
  });

  it('paginates when NextToken is returned', async () => {
    mockSend
      .mockResolvedValueOnce({
        Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:000000000000:t1' }],
        NextToken: 'tok',
      })
      .mockResolvedValueOnce({
        Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:000000000000:t2' }],
      });
    const probe = new SnsProbe(client, ['t2']);

    const out = await probe.run();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
  });
});
