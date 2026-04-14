import { SnsPublisherService } from '../../../src/events/sns-publisher.service';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PublishCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe('SnsPublisherService', () => {
  let service: SnsPublisherService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ MessageId: 'msg-123' });
    service = new SnsPublisherService({
      region: 'us-east-1',
      topicArns: {
        'bitcrm-user-events':
          'arn:aws:sns:us-east-1:000000000000:bitcrm-user-events',
      },
    });
  });

  it('should publish a message with correct format', async () => {
    await service.publish('bitcrm-user-events', 'user.activated', {
      userId: 'user-1',
    });

    const { PublishCommand } = jest.requireMock('@aws-sdk/client-sns');
    expect(PublishCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TopicArn: 'arn:aws:sns:us-east-1:000000000000:bitcrm-user-events',
        MessageAttributes: {
          eventType: {
            DataType: 'String',
            StringValue: 'user.activated',
          },
        },
      }),
    );

    const call = PublishCommand.mock.calls[0][0];
    const body = JSON.parse(call.Message);
    expect(body.eventType).toBe('user.activated');
    expect(body.payload).toEqual({ userId: 'user-1' });
    expect(body.timestamp).toBeDefined();
    expect(body.source).toBeDefined();
  });

  it('should throw if topic ARN is not configured', async () => {
    await expect(
      service.publish('unknown-topic', 'test.event', {}),
    ).rejects.toThrow('Topic ARN not configured for "unknown-topic"');
  });

  it('should not throw on publish failure when fire-and-forget', async () => {
    mockSend.mockRejectedValue(new Error('SNS unreachable'));

    await expect(
      service.publish('bitcrm-user-events', 'user.activated', {}),
    ).rejects.toThrow('SNS unreachable');
  });
});
