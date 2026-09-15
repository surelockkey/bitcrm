import { InboundReplayHandler } from '../../../src/inbound/inbound-replay.handler';
import { type InboundService } from '../../../src/inbound/inbound.service';

describe('InboundReplayHandler', () => {
  const ingest = jest.fn().mockResolvedValue({ outcome: 'stored', conversationId: 'c1' });
  const handler = new InboundReplayHandler({ ingest } as unknown as InboundService);

  beforeEach(() => ingest.mockClear());

  it('runs a captured form through the inbound pipeline as source=fallback', async () => {
    await handler.handle({
      s3Key: 'k',
      capturedAt: 'x',
      payload: { MessageSid: 'SM1', AccountSid: 'AC1', From: '+14045551234', To: '+15550001111', Body: 'hi', NumMedia: '0' },
    });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ providerSid: 'SM1', from: '+14045551234', to: '+15550001111', body: 'hi' }),
      { source: 'fallback' },
    );
  });

  it('drops a malformed capture instead of retrying it forever', async () => {
    await expect(handler.handle({ payload: { Body: 'no sid' }, capturedAt: 'x' })).resolves.toBeUndefined();
    expect(ingest).not.toHaveBeenCalled();
  });

  it('lets a storage failure propagate so SQS redelivers', async () => {
    ingest.mockRejectedValueOnce(new Error('dynamo down'));
    await expect(
      handler.handle({ payload: { MessageSid: 'SM1', From: '+14045551234', To: '+15550001111' }, capturedAt: 'x' }),
    ).rejects.toThrow('dynamo down');
  });
});
