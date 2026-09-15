import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { EmailSender, TAG_CONVERSATION, TAG_CREATED, TAG_MESSAGE, type OutboundEmail } from '../../../src/email/email-sender';
import { T1 } from '../mocks';

function make(opts: { maxInline?: number; sendResult?: { MessageId?: string } | Error; fetchStatus?: number } = {}) {
  const ses = {
    send: jest.fn(async (_cmd: SendEmailCommand) => {
      if (opts.sendResult instanceof Error) throw opts.sendResult;
      return opts.sendResult ?? { MessageId: 'ses-1' };
    }),
  };
  const s3 = { getPresignedDownloadUrl: jest.fn(async (key: string, ttl: number) => `https://s3/get/${key}?ttl=${ttl}`) };
  const fetchMock = jest.fn(async (url: string) => ({
    ok: (opts.fetchStatus ?? 200) < 400,
    status: opts.fetchStatus ?? 200,
    arrayBuffer: async () => Uint8Array.from(Buffer.from(`bytes-of:${url}`)).buffer,
  }));
  const sender = new EmailSender(
    ses as any,
    s3 as any,
    { configurationSet: 'cs-1', maxInlineAttachmentBytes: opts.maxInline ?? 1000, attachmentLinkTtlSeconds: 604800 },
    { fetch: fetchMock as unknown as typeof fetch },
  );
  return { sender, ses, s3, fetchMock };
}

const email = (over: Partial<OutboundEmail> = {}): OutboundEmail => ({
  conversationId: 'c1',
  messageId: 'm1',
  createdAt: T1,
  from: 'office@example.com',
  fromHeader: '"Sure Lock" <office@example.com>',
  replyTo: 'c-c1@reply.example.com',
  to: 'jane@example.com',
  subject: 'Your key',
  text: 'Hi Jane',
  html: '<p>Hi Jane</p>',
  ...over,
});

const inputOf = (ses: { send: { mock: { calls: unknown[][] } } }) => (ses.send.mock.calls[0][0] as SendEmailCommand).input;

describe('EmailSender.send', () => {
  it('sends simple content with the configuration set, reply-to, threading headers and the key tags', async () => {
    const { sender, ses } = make();
    const result = await sender.send(email({ inReplyTo: '<a@x>', references: ['<r@x>', '<a@x>'], cc: ['boss@example.com'] }));

    expect(result).toEqual({ messageId: 'ses-1', attachments: 'none' });
    expect(ses.send.mock.calls[0][0]).toBeInstanceOf(SendEmailCommand);
    expect(inputOf(ses)).toEqual({
      FromEmailAddress: '"Sure Lock" <office@example.com>',
      Destination: { ToAddresses: ['jane@example.com'], CcAddresses: ['boss@example.com'] },
      ReplyToAddresses: ['c-c1@reply.example.com'],
      ConfigurationSetName: 'cs-1',
      EmailTags: [
        { Name: TAG_CONVERSATION, Value: 'c1' },
        { Name: TAG_MESSAGE, Value: 'm1' },
        { Name: TAG_CREATED, Value: String(Date.parse(T1)) },
      ],
      Content: {
        Simple: {
          Subject: { Data: 'Your key', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Hi Jane', Charset: 'UTF-8' }, Html: { Data: '<p>Hi Jane</p>', Charset: 'UTF-8' } },
          Headers: [
            { Name: 'In-Reply-To', Value: '<a@x>' },
            { Name: 'References', Value: '<r@x> <a@x>' },
          ],
        },
      },
    });
  });

  it('omits what is not configured: no reply-to, no configuration set, no html, no headers', async () => {
    const ses = { send: jest.fn(async () => ({ MessageId: 'ses-2' })) };
    const sender = new EmailSender(ses as any, {} as any, { maxInlineAttachmentBytes: 1, attachmentLinkTtlSeconds: 1 });
    await sender.send(email({ replyTo: undefined, html: undefined }));
    const input = inputOf(ses);
    expect(input).not.toHaveProperty('ReplyToAddresses');
    expect(input).not.toHaveProperty('ConfigurationSetName');
    expect(input.Content?.Simple?.Body).toEqual({ Text: { Data: 'Hi Jane', Charset: 'UTF-8' } });
    expect(input.Content?.Simple).not.toHaveProperty('Headers');
  });

  it('builds raw MIME with the files inside when the stored attachments fit the inline budget', async () => {
    const { sender, ses, s3, fetchMock } = make({ maxInline: 1000 });
    const result = await sender.send(
      email({
        attachments: [
          { id: 'a1', fileName: 'door.jpg', contentType: 'image/jpeg', size: 300, status: 'stored', s3Key: 'messaging/uploads/u1/a1' },
          { id: 'a2', fileName: 'pending.jpg', contentType: 'image/jpeg', size: 300, status: 'pending' },
          { id: 'a3', fileName: 'note.txt', contentType: 'text/plain', size: 100, status: 'stored', s3Key: 'messaging/uploads/u1/a3' },
        ],
      }),
    );
    expect(result.attachments).toBe('inline');
    expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith('messaging/uploads/u1/a1', 300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const input = inputOf(ses);
    expect(input.Content?.Raw?.Data).toBeInstanceOf(Buffer);
    const raw = Buffer.from(input.Content!.Raw!.Data as Uint8Array).toString('utf8');
    expect(raw).toContain('From: "Sure Lock" <office@example.com>');
    expect(raw).toContain('Reply-To: c-c1@reply.example.com');
    expect(raw).toContain('filename="door.jpg"');
    expect(raw).toContain('filename="note.txt"');
    expect(raw).not.toContain('pending.jpg');
    // base64 bodies are wrapped at 76 columns; compare unwrapped
    expect(raw.replace(/\r\n/g, '')).toContain(Buffer.from('bytes-of:https://s3/get/messaging/uploads/u1/a1?ttl=300').toString('base64'));
    expect(input.Destination).toEqual({ ToAddresses: ['jane@example.com'] });
    expect(input.EmailTags).toHaveLength(3);
  });

  it('falls back to presigned links in both bodies when the attachments are too big to inline', async () => {
    const { sender, ses, s3, fetchMock } = make({ maxInline: 100 });
    const result = await sender.send(
      email({ attachments: [{ id: 'a1', fileName: 'scan.pdf', contentType: 'application/pdf', size: 4_000_000, status: 'stored', s3Key: 'k1' }] }),
    );
    expect(result.attachments).toBe('links');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith('k1', 604800);
    const simple = inputOf(ses).Content!.Simple!;
    expect(simple.Body!.Text!.Data).toBe('Hi Jane\n\nAttachments:\n- scan.pdf (3.8 MB): https://s3/get/k1?ttl=604800');
    expect(simple.Body!.Html!.Data).toBe('<p>Hi Jane</p><p>Attachments:</p><ul><li><a href="https://s3/get/k1?ttl=604800">scan.pdf</a> (3.8 MB)</li></ul>');
  });

  it('propagates SES failures and treats a missing MessageId or a failed download as an error', async () => {
    const refused = make({ sendResult: Object.assign(new Error('rejected'), { name: 'MessageRejected' }) });
    await expect(refused.sender.send(email())).rejects.toThrow('rejected');

    const empty = make({ sendResult: {} });
    await expect(empty.sender.send(email())).rejects.toThrow(/no MessageId/);

    const gone = make({ fetchStatus: 404 });
    await expect(
      gone.sender.send(email({ attachments: [{ id: 'a1', fileName: 'x', contentType: 'text/plain', size: 1, status: 'stored', s3Key: 'k' }] })),
    ).rejects.toThrow(/HTTP 404/);
    expect(gone.ses.send).not.toHaveBeenCalled();
  });
});
