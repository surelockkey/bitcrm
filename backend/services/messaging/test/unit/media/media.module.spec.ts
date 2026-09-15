import { registerMediaQueueHandlers } from '../../../src/media/media.module';
import { INBOUND_REPLAY_JOB, MEDIA_COPY_JOB } from '../../../src/media/media.jobs';

describe('MediaModule queue handlers', () => {
  it('routes media.copy to MediaService and inbound.replay to the replay handler', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<void>>();
    const consumer = { registerHandler: jest.fn((type: string, fn: (payload: unknown) => Promise<void>) => handlers.set(type, fn)) };
    const media = { copy: jest.fn().mockResolvedValue({ stored: 1, skipped: 0, failed: 0, retryable: 0 }) };
    const replay = { handle: jest.fn().mockResolvedValue(undefined) };

    registerMediaQueueHandlers(consumer, media, replay);

    expect([...handlers.keys()]).toEqual([MEDIA_COPY_JOB, INBOUND_REPLAY_JOB]);
    const copyJob = { conversationId: 'c1', messageId: 'm1', createdAt: 'x', providerSid: 'MM1', attachments: [] };
    await expect(handlers.get(MEDIA_COPY_JOB)!(copyJob)).resolves.toBeUndefined();
    expect(media.copy).toHaveBeenCalledWith(copyJob);

    const replayJob = { payload: { MessageSid: 'SM1' }, capturedAt: 'x' };
    await handlers.get(INBOUND_REPLAY_JOB)!(replayJob);
    expect(replay.handle).toHaveBeenCalledWith(replayJob);
  });

  it('lets a handler failure propagate so the shared consumer leaves the message for redelivery', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<void>>();
    const consumer = { registerHandler: jest.fn((type: string, fn: (payload: unknown) => Promise<void>) => handlers.set(type, fn)) };
    registerMediaQueueHandlers(consumer, { copy: jest.fn().mockRejectedValue(new Error('retry me')) }, { handle: jest.fn() });
    await expect(handlers.get(MEDIA_COPY_JOB)!({})).rejects.toThrow('retry me');
  });
});
