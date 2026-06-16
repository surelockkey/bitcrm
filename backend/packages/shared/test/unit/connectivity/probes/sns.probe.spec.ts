import { SnsProbe } from '../../../../src/connectivity/probes/sns.probe';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetTopicAttributesCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { SNSClient } from '@aws-sdk/client-sns';

const TOPIC = 'arn:aws:sns:us-east-1:000000000000:bitcrm-dev-deal-events';

describe('SnsProbe', () => {
  let client: SNSClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SNSClient({});
  });

  it('is ok when each required topic can be described', async () => {
    mockSend.mockResolvedValue({ Attributes: { TopicArn: TOPIC } });
    const probe = new SnsProbe(client, [TOPIC]);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.resources).toEqual([{ resource: TOPIC, present: true }]);
    expect(out.message).toContain('1/1');
    // scoped per-topic GetTopicAttributes, no account-wide ListTopics
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('reports a topic as not present when GetTopicAttributes fails', async () => {
    mockSend.mockRejectedValue(
      Object.assign(new Error('not found'), {
        name: 'NotFoundException',
      }),
    );
    const probe = new SnsProbe(client, [TOPIC]);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: TOPIC, present: false, details: 'NotFoundException' },
    ]);
  });

  it('is ok with no required topics', async () => {
    const probe = new SnsProbe(client, []);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.resources).toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
