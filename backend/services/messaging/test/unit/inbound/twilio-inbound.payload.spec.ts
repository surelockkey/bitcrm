import {
  MalformedInboundPayloadError,
  mediaFileName,
  parseInboundPayload,
  providerMediaSidOf,
} from '../../../src/inbound/twilio-inbound.payload';

const MEDIA_URL =
  'https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages/MM1/Media/ME0123456789abcdef0123456789abcdef';

/** A form as Twilio posts it (every value a string). */
const form = (over: Record<string, string | undefined> = {}) => ({
  MessageSid: 'SM1',
  SmsSid: 'SM1',
  AccountSid: 'AC00000000000000000000000000000000',
  MessagingServiceSid: 'MG1',
  From: '+1 (404) 555-1234',
  To: '+15550001111',
  Body: '  Hello there ',
  NumMedia: '0',
  NumSegments: '1',
  ...over,
});

describe('parseInboundPayload', () => {
  it('normalises the phones and trims the text', () => {
    expect(parseInboundPayload(form())).toEqual({
      providerSid: 'SM1',
      accountSid: 'AC00000000000000000000000000000000',
      messagingServiceSid: 'MG1',
      from: '+14045551234',
      to: '+15550001111',
      body: 'Hello there',
      segments: 1,
      media: [],
      optOutType: undefined,
    });
  });

  it('expands NumMedia into the media list with the ME sid parsed from each URL', () => {
    const input = parseInboundPayload(
      form({
        MessageSid: 'MM1',
        NumMedia: '2',
        MediaUrl0: MEDIA_URL,
        MediaContentType0: 'image/jpeg',
        MediaUrl1: 'https://example.test/plain',
        MediaContentType1: undefined,
        Body: '',
      }),
    );
    expect(input.body).toBeUndefined();
    expect(input.media).toEqual([
      { index: 0, url: MEDIA_URL, contentType: 'image/jpeg', providerMediaSid: 'ME0123456789abcdef0123456789abcdef' },
      { index: 1, url: 'https://example.test/plain', contentType: 'application/octet-stream', providerMediaSid: undefined },
    ]);
  });

  it('narrows OptOutType to STOP / START / HELP, case-insensitively', () => {
    expect(parseInboundPayload(form({ OptOutType: 'STOP' })).optOutType).toBe('STOP');
    expect(parseInboundPayload(form({ OptOutType: 'start' })).optOutType).toBe('START');
    expect(parseInboundPayload(form({ OptOutType: 'HELP' })).optOutType).toBe('HELP');
    expect(parseInboundPayload(form({ OptOutType: 'WHATEVER' })).optOutType).toBeUndefined();
  });

  it('falls back to SmsSid and ignores a non-numeric NumSegments', () => {
    const input = parseInboundPayload(form({ MessageSid: undefined, SmsSid: 'SM9', NumSegments: 'x' }));
    expect(input.providerSid).toBe('SM9');
    expect(input.segments).toBeUndefined();
  });

  it.each([
    ['not a form', 'nope'],
    ['MessageSid missing', form({ MessageSid: '', SmsSid: '' })],
    ['From missing', form({ From: undefined })],
    ['To missing', form({ To: ' ' })],
    ['From is not a phone number', form({ From: 'abc' })],
    ['To is not a phone number', form({ To: '12' })],
  ])('rejects a payload with %s', (reason, raw) => {
    expect(() => parseInboundPayload(raw)).toThrow(MalformedInboundPayloadError);
    try {
      parseInboundPayload(raw);
    } catch (e) {
      expect((e as MalformedInboundPayloadError).reason).toContain(reason.split(' ')[0]);
    }
  });
});

describe('media helpers', () => {
  it('parses the media sid out of a Twilio media URL', () => {
    expect(providerMediaSidOf(MEDIA_URL)).toBe('ME0123456789abcdef0123456789abcdef');
    expect(providerMediaSidOf('https://example.test/x')).toBeUndefined();
  });

  it('names files after the media sid with an extension from the content type', () => {
    expect(mediaFileName({ index: 0, contentType: 'image/jpeg', providerMediaSid: 'ME1' })).toBe('ME1.jpg');
    expect(mediaFileName({ index: 2, contentType: 'text/vcard; charset=utf-8' })).toBe('media-2.vcf');
    expect(mediaFileName({ index: 0, contentType: 'application/x-foo+bar', providerMediaSid: 'ME2' })).toBe('ME2.xfoobar');
    expect(mediaFileName({ index: 0, contentType: 'weird' })).toBe('media-0.bin');
  });
});
