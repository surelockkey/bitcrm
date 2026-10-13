import { DynamoDbService } from '@bitcrm/shared';
import { RecordingArchiveService, recordingS3Key } from '../../src/calls/recording-archive.service';
import { CallsRepository, type CallRecord } from '../../src/calls/calls.repository';
import { CallsController } from '../../src/calls/calls.controller';
import { type CallsService } from '../../src/calls/calls.service';
import { WebhookQueue } from '../../src/common/webhook-queue';
import { type TelephonyConfig } from '../../src/telephony/telephony.config';

/**
 * `GET /calls/:sid/recording` streamed Twilio's mp3 through Node on every
 * play, with no Range support. When the recording-status webhook lands, the
 * recording is copied into our bucket in the background (the webhook queue —
 * the webhook never waits for it) and its key stored on the call
 * (`recordingKey`, the field imported Workiz calls already use). From then on
 * the audio is served from S3: a presigned URL for a client that can follow
 * one, bytes with Range support for the blob player. A recording not yet
 * copied keeps the Twilio path.
 */

const CONFIG = { accountSid: 'AC0000', authToken: 'tok' } as TelephonyConfig;

describe('recordingS3Key', () => {
  it('lives beside the imported calls, one object per recording', () => {
    expect(recordingS3Key('CA1', 'RE1')).toBe('calls/recordings/CA1/RE1.mp3');
  });
});

describe('RecordingArchiveService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function make(opts: { s3?: boolean; queue?: WebhookQueue } = {}) {
    const s3 = { putObject: jest.fn().mockResolvedValue(undefined) };
    const repo = { setRecordingKey: jest.fn().mockResolvedValue(true) };
    const sleep = jest.fn().mockResolvedValue(undefined);
    const service = new RecordingArchiveService(
      repo as never,
      CONFIG,
      opts.s3 === false ? undefined : (s3 as never),
      opts.queue,
      sleep,
    );
    return { service, s3, repo, sleep };
  }

  const mp3 = () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    headers: new Headers({ 'content-type': 'audio/mpeg' }),
  });

  it('copies the Twilio mp3 into the bucket and stores the key on the call', async () => {
    global.fetch = jest.fn().mockResolvedValue(mp3()) as never;
    const { service, s3, repo } = make();

    await expect(service.archive('CA1', 'RE1')).resolves.toBe('calls/recordings/CA1/RE1.mp3');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC0000/Recordings/RE1.mp3');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC0000:tok').toString('base64')}`,
    );
    expect(s3.putObject).toHaveBeenCalledWith(
      'calls/recordings/CA1/RE1.mp3',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'audio/mpeg', metadata: expect.objectContaining({ recordingSid: 'RE1' }) }),
    );
    expect(repo.setRecordingKey).toHaveBeenCalledWith('CA1', 'calls/recordings/CA1/RE1.mp3');
  });

  it('retries a Twilio miss (the media can lag its own callback), then gives up loudly', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
    const { service, s3, sleep } = make();

    await expect(service.archive('CA1', 'RE1')).rejects.toThrow('404');

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(s3.putObject).not.toHaveBeenCalled();
  });

  it('schedule hands the copy to the webhook queue and returns at once', async () => {
    let release!: () => void;
    global.fetch = jest.fn(() => new Promise((r) => (release = () => r(mp3())))) as never;
    const queue = new WebhookQueue();
    const { service, repo } = make({ queue });

    service.schedule('CA1', 'RE1');
    expect(queue.size).toBe(1);
    expect(repo.setRecordingKey).not.toHaveBeenCalled();

    await new Promise((r) => setImmediate(r));
    release();
    await queue.idle();
    expect(repo.setRecordingKey).toHaveBeenCalled();
  });

  it('a failed copy never escapes the queue', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as never;
    const queue = new WebhookQueue();
    const { service } = make({ queue });

    service.schedule('CA1', 'RE1');
    await expect(queue.idle()).resolves.toBeUndefined();
  });

  it('without a bucket there is nothing to do', () => {
    global.fetch = jest.fn() as never;
    const { service } = make({ s3: false });

    service.schedule('CA1', 'RE1');

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('CallsRepository.setRecordingKey', () => {
  it('stamps the key once — never over an imported one, never on a phantom row', async () => {
    const sent: Array<Record<string, any>> = [];
    const client = { send: jest.fn(async (cmd: { input: Record<string, any> }) => void sent.push(cmd.input)) };
    const repo = new CallsRepository({ client } as unknown as DynamoDbService);

    await expect(repo.setRecordingKey('CA1', 'calls/recordings/CA1/RE1.mp3')).resolves.toBe(true);

    expect(sent[0].UpdateExpression).toContain('#recordingKey = :key');
    expect(sent[0].ConditionExpression).toContain('attribute_exists(PK)');
    expect(sent[0].ConditionExpression).toContain('attribute_not_exists(#recordingKey)');
  });

  it('a key already there is not an error', async () => {
    const client = {
      send: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' })),
    };
    const repo = new CallsRepository({ client } as unknown as DynamoDbService);

    await expect(repo.setRecordingKey('CA1', 'k')).resolves.toBe(false);
  });
});

describe('CallsController — recordings out of the bucket', () => {
  const record = (over: Partial<CallRecord> = {}): CallRecord => ({
    callSid: 'CA1',
    status: 'completed',
    startedAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    ...over,
  });

  function make(call: CallRecord | null, s3Over: Record<string, unknown> = {}) {
    const calls = { getBySid: jest.fn().mockResolvedValue(call) } as unknown as CallsService;
    const s3 = {
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://bucket.s3/calls/recordings/CA1/RE1.mp3?X-Amz-Signature=sig'),
      getObjectBuffer: jest.fn().mockResolvedValue({ body: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), contentType: 'audio/mpeg' }),
      ...s3Over,
    };
    const none = {} as never;
    const controller = new CallsController(
      calls, none, none, none, none, none, none, none, none, none, CONFIG, s3 as never,
    );
    return { controller, s3 };
  }

  function makeRes() {
    const res: Record<string, any> = {
      headers: {} as Record<string, string>,
      statusCode: 200,
      set: jest.fn((h: Record<string, string>) => Object.assign(res.headers, h)),
      status: jest.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      redirect: jest.fn(),
      end: jest.fn(),
    };
    return res;
  }

  it('redirect=1 → 302 to a short-lived presigned URL', async () => {
    const { controller, s3 } = make(record({ recordingSid: 'RE1', recordingKey: 'calls/recordings/CA1/RE1.mp3' }));
    const res = makeRes();

    await controller.recording('CA1', res as never, '1');

    expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith('calls/recordings/CA1/RE1.mp3', expect.objectContaining({ expiresIn: 300 }));
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('X-Amz-Signature'));
  });

  it('GET /:sid/recording/url answers the presigned URL for the player to stream and seek', async () => {
    const { controller } = make(record({ recordingKey: 'calls/recordings/CA1/RE1.mp3' }));

    const out = await controller.recordingUrl('CA1');

    expect(out.data).toEqual({ url: expect.stringContaining('X-Amz-Signature'), expiresIn: 300 });
  });

  it('…and 404s for a recording not in the bucket yet (the blob route still plays it)', async () => {
    const { controller } = make(record({ recordingSid: 'RE1' }));

    await expect(controller.recordingUrl('CA1')).rejects.toMatchObject({ status: 404 });
  });

  it('the bytes route serves a Range from the bucket copy', async () => {
    const { controller } = make(record({ recordingKey: 'calls/recordings/CA1/RE1.mp3' }));
    const res = makeRes();

    await controller.recording('CA1', res as never, undefined, 'bytes=2-5');

    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.headers['Content-Range']).toBe('bytes 2-5/10');
    expect(res.headers['Content-Length']).toBe('4');
    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.end).toHaveBeenCalledWith(Buffer.from([2, 3, 4, 5]));
  });

  it('an open-ended or suffix Range works too; a bad one is 416', async () => {
    const { controller } = make(record({ recordingKey: 'k' }));

    const a = makeRes();
    await controller.recording('CA1', a as never, undefined, 'bytes=7-');
    expect(a.headers['Content-Range']).toBe('bytes 7-9/10');

    const b = makeRes();
    await controller.recording('CA1', b as never, undefined, 'bytes=-3');
    expect(b.headers['Content-Range']).toBe('bytes 7-9/10');

    const c = makeRes();
    await controller.recording('CA1', c as never, undefined, 'bytes=20-30');
    expect(c.status).toHaveBeenCalledWith(416);
    expect(c.headers['Content-Range']).toBe('bytes */10');
  });

  it('no Range → the whole object, advertising that ranges work', async () => {
    const { controller } = make(record({ recordingKey: 'k' }));
    const res = makeRes();

    await controller.recording('CA1', res as never);

    expect(res.headers['Accept-Ranges']).toBe('bytes');
    expect(res.headers['Content-Length']).toBe('10');
    expect(res.end).toHaveBeenCalledWith(expect.any(Buffer));
  });
});
