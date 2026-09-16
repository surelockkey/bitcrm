import { type S3Service, type TwilioRest } from '@bitcrm/shared';
import { type Message } from '@bitcrm/types';
import { MediaService } from '../../../src/media/media.service';
import { type MediaCopyJob } from '../../../src/media/media.jobs';
import { type MessagesRepository } from '../../../src/messages/messages.repository';
import { T1, createMockMessage } from '../mocks';

const ACCOUNT = 'AC00000000000000000000000000000000';
const TOKEN = 'the-auth-token';
const URL0 = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/MM1/Media/ME0`;
const URL1 = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/MM1/Media/ME1`;

const job = (over: Partial<MediaCopyJob> = {}): MediaCopyJob => ({
  conversationId: 'c1',
  messageId: 'm1',
  createdAt: T1,
  providerSid: 'MM1',
  attachments: [
    { id: 'a0', sourceUrl: URL0, contentType: 'image/jpeg', providerMediaSid: 'ME0' },
    { id: 'a1', sourceUrl: URL1, contentType: 'image/png', providerMediaSid: 'ME1' },
  ],
  ...over,
});

const stored = (over: Partial<Message> = {}) =>
  createMockMessage({
    id: 'm1',
    providerSid: 'MM1',
    attachments: [
      { id: 'a0', fileName: 'ME0.jpg', contentType: 'image/jpeg', status: 'pending', sourceUrl: URL0, providerMediaSid: 'ME0' },
      { id: 'a1', fileName: 'ME1.png', contentType: 'image/png', status: 'pending', sourceUrl: URL1, providerMediaSid: 'ME1' },
    ],
    ...over,
  });

/** One scripted HTTP answer per download, in call order. */
type Answer = { status: number; body?: string; type?: string; length?: string } | Error;

function httpResponse(a: Exclude<Answer, Error>) {
  const bytes = Buffer.from(a.body ?? '');
  const headers = new Map<string, string>();
  if (a.type) headers.set('content-type', a.type);
  headers.set('content-length', a.length ?? String(bytes.byteLength));
  return {
    ok: a.status >= 200 && a.status < 300,
    status: a.status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

function make(opts: {
  message?: Message | null;
  answers?: Answer[];
  deleteFromTwilio?: boolean;
  updateApplied?: boolean;
  s3Error?: Error;
  maxBytes?: number;
} = {}) {
  const fetchMock = jest.fn();
  for (const a of opts.answers ?? []) {
    if (a instanceof Error) fetchMock.mockRejectedValueOnce(a);
    else fetchMock.mockResolvedValueOnce(httpResponse(a));
  }
  const s3 = { putObject: opts.s3Error ? jest.fn().mockRejectedValue(opts.s3Error) : jest.fn().mockResolvedValue(undefined) };
  const messages = {
    get: jest.fn().mockResolvedValue(opts.message === undefined ? stored() : opts.message),
    updateAttachment: jest.fn().mockResolvedValue(opts.updateApplied ?? true),
  };
  const remove = jest.fn().mockResolvedValue(true);
  const client = { messages: jest.fn(() => ({ media: jest.fn(() => ({ remove })) })) };
  const twilioRest = { run: jest.fn((fn: (c: unknown) => Promise<unknown>) => fn(client)) };
  const service = new MediaService(
    { accountSid: ACCOUNT, authToken: TOKEN },
    twilioRest as unknown as TwilioRest,
    s3 as unknown as S3Service,
    messages as unknown as MessagesRepository,
    { fetch: fetchMock as unknown as typeof fetch, deleteFromTwilio: opts.deleteFromTwilio ?? false, kmsKeyId: 'alias/docs', maxBytes: opts.maxBytes },
  );
  return { service, fetchMock, s3, messages, remove, client, twilioRest };
}

describe('MediaService.copy', () => {
  it('downloads each file with Basic auth, stores it under messaging/<conv>/<msg>/<att> with KMS and marks it stored', async () => {
    const { service, fetchMock, s3, messages, remove } = make({
      answers: [
        { status: 200, body: 'jpegbytes', type: 'image/jpeg' },
        { status: 200, body: 'pngbytes!!', type: 'image/png; charset=binary' },
      ],
    });
    const report = await service.copy(job());

    expect(report).toEqual({ stored: 2, skipped: 0, failed: 0, retryable: 0 });
    expect(messages.get).toHaveBeenCalledWith({ conversationId: 'c1', createdAt: T1, messageId: 'm1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL0);
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`${ACCOUNT}:${TOKEN}`).toString('base64')}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(s3.putObject).toHaveBeenNthCalledWith(1, 'messaging/c1/m1/a0', Buffer.from('jpegbytes'), {
      contentType: 'image/jpeg',
      kmsKeyId: 'alias/docs',
      metadata: { source: 'twilio', messagesid: 'MM1', mediasid: 'ME0' },
    });
    expect(s3.putObject).toHaveBeenNthCalledWith(2, 'messaging/c1/m1/a1', Buffer.from('pngbytes!!'), expect.objectContaining({ contentType: 'image/png' }));

    expect(messages.updateAttachment).toHaveBeenCalledWith(
      { conversationId: 'c1', createdAt: T1, messageId: 'm1' },
      'a0',
      { status: 'stored', s3Key: 'messaging/c1/m1/a0', size: 9, contentType: 'image/jpeg' },
    );
    expect(messages.updateAttachment).toHaveBeenCalledWith(expect.anything(), 'a1', expect.objectContaining({ size: 10 }));
    expect(remove).not.toHaveBeenCalled();
  });

  it('skips attachments already stored by an earlier delivery of the job', async () => {
    const message = stored();
    message.attachments![0].status = 'stored';
    const { service, fetchMock, s3 } = make({ message, answers: [{ status: 200, body: 'x', type: 'image/png' }] });
    const report = await service.copy(job());
    expect(report).toEqual({ stored: 1, skipped: 1, failed: 0, retryable: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(URL1);
    expect(s3.putObject).toHaveBeenCalledTimes(1);
  });

  it('a 4xx from Twilio marks the attachment failed and does not retry', async () => {
    const { service, messages } = make({ answers: [{ status: 404 }, { status: 200, body: 'ok', type: 'image/png' }] });
    const report = await service.copy(job());
    expect(report).toEqual({ stored: 1, skipped: 0, failed: 1, retryable: 0 });
    expect(messages.updateAttachment).toHaveBeenCalledWith(expect.anything(), 'a0', { status: 'failed' });
  });

  it('an oversize file is failed, not buffered', async () => {
    const { service, s3, messages } = make({
      answers: [{ status: 200, body: 'tiny', type: 'image/jpeg', length: '99999999' }, { status: 200, body: 'ok', type: 'image/png' }],
      maxBytes: 1000,
    });
    const report = await service.copy(job());
    expect(report.failed).toBe(1);
    expect(s3.putObject).toHaveBeenCalledTimes(1);
    expect(messages.updateAttachment).toHaveBeenCalledWith(expect.anything(), 'a0', { status: 'failed' });
  });

  it('transient failures (network, 5xx, 429, S3) are collected and rethrown after the rest was handled', async () => {
    const network = make({ answers: [new Error('ECONNRESET'), { status: 200, body: 'ok', type: 'image/png' }] });
    await expect(network.service.copy(job())).rejects.toThrow(/1 media of MM1 not copied: a0: ECONNRESET/);
    expect(network.s3.putObject).toHaveBeenCalledTimes(1);
    expect(network.messages.updateAttachment).toHaveBeenCalledTimes(1);
    expect(network.messages.updateAttachment).toHaveBeenCalledWith(expect.anything(), 'a1', expect.objectContaining({ status: 'stored' }));

    const throttled = make({ answers: [{ status: 429 }, { status: 503 }] });
    await expect(throttled.service.copy(job())).rejects.toThrow(/2 media of MM1 not copied/);
    expect(throttled.messages.updateAttachment).not.toHaveBeenCalled();

    const s3Down = make({ answers: [{ status: 200, body: 'a', type: 'image/jpeg' }, { status: 200, body: 'b', type: 'image/png' }], s3Error: new Error('S3 down') });
    await expect(s3Down.service.copy(job())).rejects.toThrow(/S3 down/);
  });

  it('deletes the media at Twilio once stored when configured, and shrugs off a failure there', async () => {
    const { service, remove, client, twilioRest } = make({
      deleteFromTwilio: true,
      answers: [{ status: 200, body: 'a', type: 'image/jpeg' }, { status: 200, body: 'b', type: 'image/png' }],
    });
    remove.mockRejectedValueOnce(new Error('Twilio 404'));
    const report = await service.copy(job());

    expect(report.stored).toBe(2);
    expect(twilioRest.run).toHaveBeenCalledTimes(2);
    expect(client.messages).toHaveBeenCalledWith('MM1');
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does not delete at Twilio when the attachment could not be marked stored', async () => {
    const { service, remove } = make({
      deleteFromTwilio: true,
      updateApplied: false,
      answers: [{ status: 200, body: 'a', type: 'image/jpeg' }, { status: 200, body: 'b', type: 'image/png' }],
    });
    await service.copy(job());
    expect(remove).not.toHaveBeenCalled();
  });

  it('drops a job whose message no longer exists', async () => {
    const { service, fetchMock } = make({ message: null });
    expect(await service.copy(job())).toEqual({ stored: 0, skipped: 2, failed: 0, retryable: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
