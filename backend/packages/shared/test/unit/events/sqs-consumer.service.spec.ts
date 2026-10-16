import { SqsConsumerService } from '../../../src/events/sqs-consumer.service';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  ReceiveMessageCommand: jest.fn().mockImplementation((input) => ({
    type: 'receive',
    input,
  })),
  DeleteMessageCommand: jest.fn().mockImplementation((input) => ({
    type: 'delete',
    input,
  })),
}));

describe('SqsConsumerService', () => {
  let service: SqsConsumerService;
  const mockHandler = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockHandler.mockResolvedValue(undefined);
    service = new SqsConsumerService({
      region: 'us-east-1',
      queueUrl: 'http://localhost:4566/000000000000/test-queue',
      waitTimeSeconds: 0,
      maxMessages: 10,
    });
  });

  afterEach(() => {
    service.stop();
  });

  it('should register event handlers', () => {
    service.registerHandler('user.activated', mockHandler);
    expect(service.getHandlers().has('user.activated')).toBe(true);
  });

  it('should process a message and call the correct handler', async () => {
    service.registerHandler('user.activated', mockHandler);

    const message = {
      MessageId: 'msg-1',
      ReceiptHandle: 'receipt-1',
      Body: JSON.stringify({
        eventType: 'user.activated',
        timestamp: new Date().toISOString(),
        source: 'user-service',
        payload: { userId: 'user-1' },
      }),
    };

    mockSend.mockResolvedValueOnce({ Messages: [message] });
    mockSend.mockResolvedValueOnce({}); // delete

    await service.pollOnce();

    expect(mockHandler).toHaveBeenCalledWith({ userId: 'user-1' }, expect.objectContaining({ eventId: 'msg-1' }));
    const { DeleteMessageCommand } = jest.requireMock('@aws-sdk/client-sqs');
    expect(DeleteMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: 'http://localhost:4566/000000000000/test-queue',
        ReceiptHandle: 'receipt-1',
      }),
    );
  });

  it('should skip messages with no matching handler', async () => {
    const message = {
      MessageId: 'msg-2',
      ReceiptHandle: 'receipt-2',
      Body: JSON.stringify({
        eventType: 'unknown.event',
        timestamp: new Date().toISOString(),
        source: 'test',
        payload: {},
      }),
    };

    mockSend.mockResolvedValueOnce({ Messages: [message] });

    await service.pollOnce();

    expect(mockHandler).not.toHaveBeenCalled();
    // Should still delete unhandled messages to avoid infinite reprocessing
    const { DeleteMessageCommand } = jest.requireMock('@aws-sdk/client-sqs');
    expect(DeleteMessageCommand).toHaveBeenCalled();
  });

  it('should handle empty poll gracefully', async () => {
    mockSend.mockResolvedValueOnce({ Messages: [] });
    await service.pollOnce();
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('should not delete message if handler throws', async () => {
    const failingHandler = jest.fn().mockRejectedValue(new Error('fail'));
    service.registerHandler('user.activated', failingHandler);

    const message = {
      MessageId: 'msg-3',
      ReceiptHandle: 'receipt-3',
      Body: JSON.stringify({
        eventType: 'user.activated',
        timestamp: new Date().toISOString(),
        source: 'test',
        payload: {},
      }),
    };

    mockSend.mockResolvedValueOnce({ Messages: [message] });

    await service.pollOnce();

    const { DeleteMessageCommand } = jest.requireMock('@aws-sdk/client-sqs');
    expect(DeleteMessageCommand).not.toHaveBeenCalled();
  });

  it('should handle SNS-wrapped messages', async () => {
    service.registerHandler('user.activated', mockHandler);

    const innerMessage = JSON.stringify({
      eventType: 'user.activated',
      timestamp: new Date().toISOString(),
      source: 'user-service',
      payload: { userId: 'user-2' },
    });

    // SNS wraps the message in a Message field
    const snsWrapped = {
      MessageId: 'msg-4',
      ReceiptHandle: 'receipt-4',
      Body: JSON.stringify({
        Type: 'Notification',
        Message: innerMessage,
      }),
    };

    mockSend.mockResolvedValueOnce({ Messages: [snsWrapped] });
    mockSend.mockResolvedValueOnce({});

    await service.pollOnce();

    expect(mockHandler).toHaveBeenCalledWith({ userId: 'user-2' }, expect.objectContaining({ eventType: 'user.activated' }));
  });

  /**
   * A consumer that must act once per event (a push notification, a text)
   * needs an id that survives SQS redelivery. The payloads carry none, so
   * the consumer hands over the delivery's own: the SNS MessageId when the
   * body is an SNS envelope, else the SQS MessageId (raw delivery, which is
   * what Terraform configures) — both are the same on every redelivery.
   */
  describe('delivery meta', () => {
    it('hands the handler the SQS MessageId, event type, timestamp and source with a raw-delivery body', async () => {
      service.registerHandler('deal.tech_assigned', mockHandler);
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'sqs-msg-1',
            ReceiptHandle: 'receipt-m1',
            Body: JSON.stringify({
              eventType: 'deal.tech_assigned',
              timestamp: '2026-10-16T10:00:00.000Z',
              source: 'deal-service',
              payload: { dealId: 'd1', techId: 't1' },
            }),
          },
        ],
      });
      mockSend.mockResolvedValueOnce({});

      await service.pollOnce();

      expect(mockHandler).toHaveBeenCalledWith(
        { dealId: 'd1', techId: 't1' },
        { eventId: 'sqs-msg-1', eventType: 'deal.tech_assigned', timestamp: '2026-10-16T10:00:00.000Z', source: 'deal-service' },
      );
    });

    it('prefers the SNS MessageId of an SNS envelope (one publish delivered twice is still one event)', async () => {
      service.registerHandler('deal.tech_assigned', mockHandler);
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'sqs-msg-2',
            ReceiptHandle: 'receipt-m2',
            Body: JSON.stringify({
              Type: 'Notification',
              MessageId: 'sns-msg-2',
              Message: JSON.stringify({
                eventType: 'deal.tech_assigned',
                timestamp: '2026-10-16T10:00:00.000Z',
                source: 'deal-service',
                payload: { dealId: 'd1', techId: 't1' },
              }),
            }),
          },
        ],
      });
      mockSend.mockResolvedValueOnce({});

      await service.pollOnce();

      expect(mockHandler).toHaveBeenCalledWith(
        { dealId: 'd1', techId: 't1' },
        expect.objectContaining({ eventId: 'sns-msg-2', eventType: 'deal.tech_assigned' }),
      );
    });

    it('still accepts a one-argument handler (every consumer written before the meta existed)', async () => {
      const legacy = jest.fn(async (_payload: unknown) => undefined);
      service.registerHandler('user.activated', legacy);
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'sqs-msg-3',
            ReceiptHandle: 'receipt-m3',
            Body: JSON.stringify({ eventType: 'user.activated', timestamp: 't', source: 's', payload: { userId: 'u1' } }),
          },
        ],
      });
      mockSend.mockResolvedValueOnce({});

      await service.pollOnce();

      expect(legacy.mock.calls[0][0]).toEqual({ userId: 'u1' });
    });
  });
});
