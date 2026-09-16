import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Conversation } from '@bitcrm/types';
import { InboundEmailService, emailHtmlS3Key, inboundProviderSid, type InboundMailLocation } from '../../../src/email/inbound/inbound-email.service';
import { type AppendInboundInput } from '../../../src/messages/messages.repository';
import { createMockConversation } from '../mocks';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));
const AT = '2026-09-15T10:06:00.000Z';
const ID = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';

const location = (over: Partial<InboundMailLocation> = {}): InboundMailLocation => ({
  bucket: 'bitcrm-dev-app',
  key: 'messaging/inbound-email/ses-in-1',
  sesMessageId: 'ses-in-1',
  recipients: [`c-${ID}@reply.example.com`],
  receivedAt: '2026-09-15T10:05:30.000Z',
  spamVerdict: 'PASS',
  virusVerdict: 'PASS',
  ...over,
});

function make(f: {
  raw?: Buffer;
  seen?: boolean;
  conversation?: Conversation;
  created?: boolean;
  route?: string;
  appendDuplicate?: boolean;
  s3Error?: Error;
} = {}) {
  const conversation = f.conversation ?? createMockConversation({ id: ID, addresses: { phones: [], emails: ['jane@example.com'] } });
  const rawMail = { get: jest.fn(async () => f.raw ?? fixture('reply-plain.eml')) };
  const threads = { resolve: jest.fn(async () => ({ conversation, created: f.created ?? false, route: f.route ?? 'token', party: { kind: 'contact', id: 'ct1' } })) };
  const messages = {
    getProviderSidPointer: jest.fn(async () => (f.seen ? { providerSid: 'x', conversationId: 'c-seen' } : null)),
    appendInbound: jest.fn(async (args: AppendInboundInput) => ({ duplicate: Boolean(f.appendDuplicate), conversation: args.conversation })),
  };
  const s3 = {
    putObject: f.s3Error ? jest.fn().mockRejectedValue(f.s3Error) : jest.fn(async () => undefined),
    deleteObject: jest.fn(async () => undefined),
  };
  const sns = { publish: jest.fn(async () => undefined) };
  const metrics = { entityCreated: { inc: jest.fn() }, eventsPublished: { inc: jest.fn() }, eventsFailed: { inc: jest.fn() } };
  const realtime = { messageUpserted: jest.fn() };
  const service = new InboundEmailService(rawMail as any, threads as any, messages as any, s3 as any, { kmsKeyId: 'alias/docs' }, sns as any, metrics as any, realtime as any);
  return { service, rawMail, threads, messages, s3, sns, metrics, realtime, conversation };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('InboundEmailService.ingest', () => {
  it('stores a plain reply in the conversation the token names, with threading ids and the SES arrival time', async () => {
    const { service, rawMail, threads, messages, s3, realtime, sns, metrics, conversation } = make();
    const res = await service.ingest(location(), AT);
    await flush();

    expect(res).toEqual({ outcome: 'stored', conversationId: ID, messageId: expect.any(String), conversationCreated: false, route: 'token', attachmentsStored: 0 });
    expect(rawMail.get).toHaveBeenCalledWith('bitcrm-dev-app', 'messaging/inbound-email/ses-in-1');
    expect(threads.resolve).toHaveBeenCalledWith(
      {
        sender: 'jane@example.com',
        recipients: [`c-${ID}@reply.example.com`, `c-${ID}@reply.example.com`],
        inReplyTo: '<0100019-abc-def@email.amazonses.com>',
        references: ['<0100019-abc-def@email.amazonses.com>'],
      },
      AT,
    );
    const { message, conversation: passed, at } = messages.appendInbound.mock.calls[0][0];
    expect(passed).toBe(conversation);
    expect(at).toBe(AT);
    expect(message).toMatchObject({
      id: res.messageId,
      conversationId: ID,
      channel: 'email',
      direction: 'inbound',
      subject: 'Re: Your key',
      body: 'Yes, 3pm works for me.\n\nOn Tue, Sep 15, 2026 Sure Lock <office@example.com> wrote:\n> Your key is ready',
      from: 'jane@example.com',
      to: `c-${ID}@reply.example.com`,
      contactAddress: 'jane@example.com',
      emailMessageId: '<CAJane123@mail.example.com>',
      inReplyTo: '<0100019-abc-def@email.amazonses.com>',
      references: ['<0100019-abc-def@email.amazonses.com>'],
      status: 'received',
      provider: 'ses',
      providerSid: 'ses-inbound:ses-in-1',
      origin: 'contact',
      sentByName: 'Jane Doe',
      createdAt: '2026-09-15T10:05:30.000Z',
      updatedAt: AT,
    });
    expect(message.bodyHtml).toBeUndefined();
    expect(message.attachments).toBeUndefined();
    expect(message.cc).toBeUndefined();
    expect(s3.putObject).not.toHaveBeenCalled();
    expect(realtime.messageUpserted).toHaveBeenCalledWith(message, conversation, AT);
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'message.received', {
      messageId: message.id,
      conversationId: ID,
      channel: 'email',
      from: 'jane@example.com',
      to: `c-${ID}@reply.example.com`,
      partyKind: 'contact',
      partyId: 'ct1',
      dealId: undefined,
      providerSid: 'ses-inbound:ses-in-1',
      createdAt: '2026-09-15T10:05:30.000Z',
    });
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'conversation.updated', { conversationId: ID });
    expect(metrics.entityCreated.inc).toHaveBeenCalledWith({ entity_type: 'message' });
    expect(metrics.entityCreated.inc).not.toHaveBeenCalledWith({ entity_type: 'conversation' });
  });

  it('copies the attachments into S3 under messaging/<conv>/<msg>/<id> with KMS before the append, keeps html and cc', async () => {
    const { service, messages, s3 } = make({ raw: fixture('multipart-attachment.eml'), route: 'directory', created: true });
    const res = await service.ingest(location({ recipients: ['office@example.com'], sesMessageId: 'ses-in-2', key: 'messaging/inbound-email/ses-in-2' }), AT);

    expect(res).toMatchObject({ outcome: 'stored', conversationCreated: true, attachmentsStored: 2 });
    const { message } = messages.appendInbound.mock.calls[0][0];
    expect(message).toMatchObject({
      subject: 'Договір № 12',
      body: 'Привіт, це Іван.\nДоговір у вкладенні.',
      bodyHtml: '<html><body><p>Привіт, це <b>Іван</b>.</p><p>Договір у вкладенні.</p><img src="cid:logo@client"></body></html>',
      from: 'ivan@client.example',
      to: 'office@example.com',
      cc: ['boss@client.example'],
      sentByName: 'Іван Петренко',
      providerSid: 'ses-inbound:ses-in-2',
    });
    expect(message.bodyHtmlKey).toBeUndefined();
    expect(message.attachments).toEqual([
      { id: expect.any(String), fileName: 'договір.pdf', contentType: 'application/pdf', size: 13, status: 'stored', s3Key: `messaging/${ID}/${message.id}/${message.attachments![0].id}` },
      { id: expect.any(String), fileName: 'logo.png', contentType: 'image/png', size: 12, status: 'stored', s3Key: `messaging/${ID}/${message.id}/${message.attachments![1].id}` },
    ]);
    expect(s3.putObject).toHaveBeenNthCalledWith(1, message.attachments![0].s3Key, Buffer.from('%PDF-1.4 fake'), {
      contentType: 'application/pdf',
      kmsKeyId: 'alias/docs',
      metadata: { source: 'ses-inbound' },
    });
    expect(s3.putObject).toHaveBeenNthCalledWith(2, message.attachments![1].s3Key, expect.any(Buffer), expect.objectContaining({ metadata: { source: 'ses-inbound', contentid: 'logo@client' } }));
    // uploads happen before the transaction
    expect(s3.putObject.mock.invocationCallOrder[1]).toBeLessThan(messages.appendInbound.mock.invocationCallOrder[0]);
  });

  it('an html-only mail gets a text body derived from the markup; a mail from nobody is dropped', async () => {
    const html = make({ raw: fixture('unknown-sender.eml'), route: 'unknown', created: true });
    await html.service.ingest(location({ recipients: ['office@example.com'] }), AT);
    expect(html.messages.appendInbound.mock.calls[0][0].message).toMatchObject({
      body: 'Hi,\nI locked myself out.\nCan somebody come today?',
      bodyHtml: '<div>Hi,<br>I locked myself out.<br>Can somebody come today?</div>',
      sentByName: undefined,
    });

    const nobody = make({ raw: Buffer.from('Subject: no from\r\n\r\nhello') });
    expect(await nobody.service.ingest(location(), AT)).toMatchObject({ outcome: 'dropped', reason: 'no sender' });
    expect(nobody.threads.resolve).not.toHaveBeenCalled();
  });

  it('answers duplicate from PSID# without reading S3, and discards its uploads when the transaction guard trips', async () => {
    const seen = make({ seen: true });
    expect(await seen.service.ingest(location(), AT)).toEqual({ outcome: 'duplicate', conversationId: 'c-seen', conversationCreated: false, attachmentsStored: 0 });
    expect(seen.rawMail.get).not.toHaveBeenCalled();

    const raced = make({ raw: fixture('multipart-attachment.eml'), appendDuplicate: true });
    const res = await raced.service.ingest(location({ recipients: ['office@example.com'] }), AT);
    expect(res.outcome).toBe('duplicate');
    expect(raced.s3.deleteObject).toHaveBeenCalledTimes(2);
    expect(raced.sns.publish).not.toHaveBeenCalled();
    expect(raced.realtime.messageUpserted).not.toHaveBeenCalled();
  });

  it('skips the attachments of a mail that failed the virus scan', async () => {
    const { service, messages, s3 } = make({ raw: fixture('multipart-attachment.eml') });
    const res = await service.ingest(location({ recipients: ['office@example.com'], virusVerdict: 'FAIL' }), AT);
    expect(res.attachmentsStored).toBe(0);
    expect(s3.putObject).not.toHaveBeenCalled();
    expect(messages.appendInbound.mock.calls[0][0].message.attachments).toBeUndefined();
  });

  it('parks an HTML body over 100 KB in S3 under bodyHtmlKey', async () => {
    const big = `<p>${'x'.repeat(120_000)}</p>`;
    const raw = Buffer.from(`From: jane@example.com\r\nTo: office@example.com\r\nContent-Type: text/html\r\n\r\n${big}`);
    const { service, messages, s3 } = make({ raw });
    const res = await service.ingest(location(), AT);
    const { message } = messages.appendInbound.mock.calls[0][0];
    expect(message.bodyHtml).toBeUndefined();
    expect(message.bodyHtmlKey).toBe(emailHtmlS3Key(res.messageId!));
    expect(message.body).toBe('x'.repeat(120_000));
    expect(s3.putObject).toHaveBeenCalledWith(emailHtmlS3Key(res.messageId!), big, { contentType: 'text/html; charset=utf-8', kmsKeyId: 'alias/docs' });
  });

  it('an S3 failure throws before anything is written, so SQS redelivers', async () => {
    const { service, messages } = make({ raw: fixture('multipart-attachment.eml'), s3Error: new Error('S3 down') });
    await expect(service.ingest(location({ recipients: ['office@example.com'] }), AT)).rejects.toThrow(/S3 down/);
    expect(messages.appendInbound).not.toHaveBeenCalled();
  });

  it('a failed SNS publish never fails the ingest', async () => {
    const { service, sns } = make();
    sns.publish.mockRejectedValue(new Error('sns down'));
    await expect(service.ingest(location(), AT)).resolves.toMatchObject({ outcome: 'stored' });
    await flush();
  });
});

describe('inboundProviderSid', () => {
  it('prefers the SES id and falls back to the object basename', () => {
    expect(inboundProviderSid({ key: 'messaging/inbound-email/abc', sesMessageId: 'abc' })).toBe('ses-inbound:abc');
    expect(inboundProviderSid({ key: 'messaging/inbound-email/def' })).toBe('ses-inbound:def');
  });
});
