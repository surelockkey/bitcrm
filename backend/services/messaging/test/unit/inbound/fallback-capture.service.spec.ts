import { type S3Service } from '@bitcrm/shared';
import { FallbackCaptureService } from '../../../src/inbound/fallback-capture.service';
import { type MediaQueueService } from '../../../src/media/media-queue.service';

const AT = '2026-09-15T10:05:00.000Z';
const payload = { MessageSid: 'SM1', From: '+14045551234', To: '+15550001111', Body: 'hi', ErrorCode: '11200' };

function make(over: { s3?: Error; queue?: Error | false; noS3?: boolean } = {}) {
  const s3 = { putObject: over.s3 ? jest.fn().mockRejectedValue(over.s3) : jest.fn().mockResolvedValue(undefined) };
  const queue = {
    enqueueInboundReplay:
      over.queue instanceof Error
        ? jest.fn().mockRejectedValue(over.queue)
        : jest.fn().mockResolvedValue(over.queue !== false),
  };
  const service = new FallbackCaptureService(
    queue as unknown as MediaQueueService,
    over.noS3 ? undefined : (s3 as unknown as S3Service),
  );
  return { service, s3, queue };
}

describe('FallbackCaptureService', () => {
  beforeEach(() => {
    delete process.env.DOCUMENTS_KMS_KEY_ID;
  });

  it('archives the raw form to S3 under inbound-raw/<day>/<sid>.json with KMS and queues a replay', async () => {
    const { service, s3, queue } = make();
    const result = await service.capture(payload, AT);

    expect(result).toEqual({ s3Key: 'messaging/inbound-raw/2026-09-15/SM1.json', queued: true });
    const [key, body, opts] = s3.putObject.mock.calls[0];
    expect(key).toBe('messaging/inbound-raw/2026-09-15/SM1.json');
    expect(JSON.parse(body)).toEqual({ capturedAt: AT, payload });
    expect(opts).toEqual({
      contentType: 'application/json',
      kmsKeyId: 'alias/bitcrm-documents',
      metadata: { source: 'twilio-fallback', messagesid: 'SM1' },
    });
    expect(queue.enqueueInboundReplay).toHaveBeenCalledWith({
      s3Key: 'messaging/inbound-raw/2026-09-15/SM1.json',
      payload,
      capturedAt: AT,
    });
  });

  it('still queues the replay when S3 is down, and still archives when the queue is', async () => {
    const noS3 = await make({ s3: new Error('S3 down') }).service.capture(payload, AT);
    expect(noS3).toEqual({ s3Key: undefined, queued: true });

    const noQueue = await make({ queue: new Error('SQS down') }).service.capture(payload, AT);
    expect(noQueue).toEqual({ s3Key: 'messaging/inbound-raw/2026-09-15/SM1.json', queued: false });
  });

  it('reports a total loss when neither store took it', async () => {
    const { service } = make({ noS3: true, queue: false });
    expect(await service.capture(payload, AT)).toEqual({ queued: false });
  });

  it('invents a key for a payload with no sid rather than refusing it', async () => {
    const { service, s3 } = make();
    const result = await service.capture({ Body: 'x' }, AT);
    expect(result.s3Key).toMatch(/^messaging\/inbound-raw\/2026-09-15\/nosid-[0-9a-f-]{36}\.json$/);
    expect(s3.putObject).toHaveBeenCalledTimes(1);
  });
});
