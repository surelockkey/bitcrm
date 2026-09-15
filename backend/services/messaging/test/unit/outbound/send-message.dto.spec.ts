import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendMessageDto, StartConversationMessageDto } from '../../../src/outbound/dto/send-message.dto';

const CM = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';

async function errorsOf<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true });
  return errors.map((e) => e.property);
}

describe('SendMessageDto', () => {
  const valid = { clientMessageId: CM, channel: 'sms', body: 'On my way' };

  it('accepts the minimal SMS', async () => {
    expect(await errorsOf(SendMessageDto, valid)).toEqual([]);
  });

  it('requires a uuid clientMessageId, a sendable channel and a body', async () => {
    expect(await errorsOf(SendMessageDto, { channel: 'sms', body: 'x', clientMessageId: 'nope' })).toEqual(['clientMessageId']);
    expect(await errorsOf(SendMessageDto, { ...valid, channel: 'note' })).toEqual(['channel']);
    expect(await errorsOf(SendMessageDto, { ...valid, body: '' })).toEqual(['body']);
    expect(await errorsOf(SendMessageDto, { ...valid, body: 'x'.repeat(1601) })).toEqual(['body']);
  });

  it('lets an email with attachments omit the body but demands a subject', async () => {
    const attachment = { id: CM, fileName: 'a.pdf', contentType: 'application/pdf', size: 10 };
    expect(await errorsOf(SendMessageDto, { clientMessageId: CM, channel: 'email', subject: 'Invoice', attachments: [attachment] })).toEqual([]);
    expect(await errorsOf(SendMessageDto, { clientMessageId: CM, channel: 'email', body: 'hi' })).toEqual(['subject']);
  });

  it('validates fromNumber as E.164 and the optional ids as uuids', async () => {
    expect(await errorsOf(SendMessageDto, { ...valid, fromNumber: '4045550100' })).toEqual(['fromNumber']);
    expect(await errorsOf(SendMessageDto, { ...valid, fromNumber: '+14045550100', dealId: CM, templateId: CM })).toEqual([]);
    expect(await errorsOf(SendMessageDto, { ...valid, dealId: '123' })).toEqual(['dealId']);
  });

  it('validates each attachment (type, size, id) and caps the count at 10', async () => {
    const ok = { id: CM, fileName: 'a.jpg', contentType: 'image/jpeg', size: 1024 };
    expect(await errorsOf(SendMessageDto, { ...valid, attachments: [ok] })).toEqual([]);
    expect(await errorsOf(SendMessageDto, { ...valid, attachments: [{ ...ok, contentType: 'application/zip' }] })).toEqual(['attachments']);
    expect(await errorsOf(SendMessageDto, { ...valid, attachments: [{ ...ok, size: 5 * 1024 * 1024 + 1 }] })).toEqual(['attachments']);
    expect(await errorsOf(SendMessageDto, { ...valid, attachments: [{ ...ok, id: 'x' }] })).toEqual(['attachments']);
    expect(await errorsOf(SendMessageDto, { ...valid, attachments: Array(11).fill(ok) })).toEqual(['attachments']);
  });
});

describe('StartConversationMessageDto', () => {
  const valid = { clientMessageId: CM, channel: 'sms', body: 'Hi' };

  it('needs a contactId or an E.164 phone', async () => {
    expect(await errorsOf(StartConversationMessageDto, valid)).toEqual(['contactId', 'phone']);
    expect(await errorsOf(StartConversationMessageDto, { ...valid, contactId: CM })).toEqual([]);
    expect(await errorsOf(StartConversationMessageDto, { ...valid, phone: '+14045551234' })).toEqual([]);
    expect(await errorsOf(StartConversationMessageDto, { ...valid, phone: '404-555-1234' })).toEqual(['phone']);
  });
});
