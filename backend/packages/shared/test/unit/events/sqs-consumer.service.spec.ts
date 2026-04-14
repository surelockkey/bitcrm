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

    expect(mockHandler).toHaveBeenCalledWith({ userId: 'user-1' });
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

    expect(mockHandler).toHaveBeenCalledWith({ userId: 'user-2' });
  });
});
