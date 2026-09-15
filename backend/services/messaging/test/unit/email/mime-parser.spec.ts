import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeEncodedWords,
  decodeQuotedPrintable,
  parseAddressList,
  parseContentType,
  parseMail,
  splitMultipart,
} from '../../../src/email/mime/mime-parser';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));

describe('parseMail — fixtures', () => {
  it('reads a plain-text reply: addresses, threading ids, folded To, the quoted body kept', () => {
    const mail = parseMail(fixture('reply-plain.eml'));
    expect(mail.from).toEqual({ name: 'Jane Doe', address: 'jane@example.com' });
    expect(mail.to).toEqual([{ name: 'Sure Lock & Key', address: 'c-6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f@reply.example.com' }]);
    expect(mail.cc).toEqual([]);
    expect(mail.subject).toBe('Re: Your key');
    expect(mail.messageId).toBe('<CAJane123@mail.example.com>');
    expect(mail.inReplyTo).toBe('<0100019-abc-def@email.amazonses.com>');
    expect(mail.references).toEqual(['<0100019-abc-def@email.amazonses.com>']);
    expect(mail.date).toBe('2026-09-15T10:05:00.000Z');
    expect(mail.text).toBe('Yes, 3pm works for me.\n\nOn Tue, Sep 15, 2026 Sure Lock <office@example.com> wrote:\n> Your key is ready');
    expect(mail.html).toBeUndefined();
    expect(mail.attachments).toEqual([]);
    expect(mail.headers.get('received')).toHaveLength(1);
    expect(mail.headers.get('received')![0]).toContain('for c-6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f@reply.example.com;');
  });

  it('reads a UTF-8 multipart mail: encoded words, quoted-printable, base64 html, RFC 2231 file name, inline image', () => {
    const mail = parseMail(fixture('multipart-attachment.eml'));
    expect(mail.from).toEqual({ name: 'Іван Петренко', address: 'ivan@client.example' });
    expect(mail.to).toEqual([{ address: 'office@example.com' }]);
    expect(mail.cc).toEqual([{ name: 'Boss, The', address: 'boss@client.example' }]);
    expect(mail.subject).toBe('Договір № 12');
    expect(mail.date).toBe('2026-09-15T09:00:00.000Z');
    expect(mail.text).toBe('Привіт, це Іван.\nДоговір у вкладенні.');
    expect(mail.html).toBe('<html><body><p>Привіт, це <b>Іван</b>.</p><p>Договір у вкладенні.</p><img src="cid:logo@client"></body></html>');
    expect(mail.attachments).toHaveLength(2);
    expect(mail.attachments[0]).toMatchObject({ fileName: 'договір.pdf', contentType: 'application/pdf', inline: false, contentId: undefined });
    expect(mail.attachments[0].content.toString()).toBe('%PDF-1.4 fake');
    expect(mail.attachments[1]).toMatchObject({ fileName: 'logo.png', contentType: 'image/png', inline: true, contentId: 'logo@client' });
    expect([...mail.attachments[1].content.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('reads an html-only mail from a bare address', () => {
    const mail = parseMail(fixture('unknown-sender.eml'));
    expect(mail.from).toEqual({ address: 'stranger@somewhere.test' });
    expect(mail.text).toBeUndefined();
    expect(mail.html).toBe('<div>Hi,<br>I locked myself out.<br>Can somebody come today?</div>');
    expect(mail.date).toBe('2026-09-16T12:30:00.000Z');
    expect(mail.inReplyTo).toBeUndefined();
    expect(mail.references).toEqual([]);
  });

  it('decodes a latin1 quoted-printable body with soft breaks, and an unparsable Date is dropped', () => {
    const mail = parseMail(fixture('latin1-qp.eml'));
    expect(mail.from).toEqual({ name: 'René', address: 'rene@example.fr' });
    expect(mail.to.map((a) => a.address)).toEqual(['office@example.com', 'second@example.com']);
    expect(mail.subject).toBe('Café ouvert');
    expect(mail.text).toBe('Café ouvert à 9h, avec une ligne très longue qui doit être coupée proprement.');
    expect(mail.date).toBeUndefined();
  });

  it('copes with a headers-only mail and with a body that has no headers at all', () => {
    expect(parseMail(Buffer.from('Subject: nothing\r\nFrom: a@b.co\r\n'))).toMatchObject({ subject: 'nothing', text: undefined, attachments: [] });
    expect(parseMail(Buffer.from('just text\r\n')).text).toBeUndefined();
  });
});

describe('MIME helpers', () => {
  it('parses content types with quoted params, RFC 2231 continuations and encoded values', () => {
    expect(parseContentType('text/HTML; charset="UTF-8"')).toEqual({ type: 'text/html', params: { charset: 'UTF-8' } });
    expect(parseContentType(undefined, 'text/plain')).toEqual({ type: 'text/plain', params: {} });
    expect(parseContentType('attachment; filename*0="long-"; filename*1="name.pdf"', '').params.filename).toBe('long-name.pdf');
    expect(parseContentType("attachment; filename*=UTF-8''caf%C3%A9.pdf", '').params.filename).toBe('café.pdf');
    expect(parseContentType("attachment; filename*0*=UTF-8''caf%C3%A9; filename*1*=%2Epdf", '').params.filename).toBe('café.pdf');
  });

  it('decodes RFC 2047 words in B and Q, dropping the whitespace between adjacent ones', () => {
    expect(decodeEncodedWords('=?UTF-8?B?0J/RgNC40LLRltGC?= world')).toBe('Привіт world');
    expect(decodeEncodedWords('=?utf-8?q?caf=C3=A9_au_lait?=')).toBe('café au lait');
    expect(decodeEncodedWords('=?UTF-8?Q?a?= =?UTF-8?Q?b?=')).toBe('ab');
    expect(decodeEncodedWords('plain')).toBe('plain');
    expect(decodeEncodedWords('=?X-UNKNOWN?Q?caf=E9?=')).toBe('café');
  });

  it('splits address lists on commas outside quotes and brackets, lower-casing addresses', () => {
    expect(parseAddressList('"Doe, Jane" <Jane@Example.com>, bob@example.com, <carol@example.com>')).toEqual([
      { name: 'Doe, Jane', address: 'jane@example.com' },
      { address: 'bob@example.com' },
      { address: 'carol@example.com' },
    ]);
    expect(parseAddressList('Undisclosed recipients:;')).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });

  it('decodes quoted-printable with soft line breaks and literal equals', () => {
    expect(decodeQuotedPrintable(Buffer.from('a=3Db=\r\nc =\nd')).toString()).toBe('a=bc d');
  });

  it('splits multipart bodies, ignoring the preamble and epilogue', () => {
    const body = Buffer.from('preamble\r\n--B\r\nContent-Type: text/plain\r\n\r\none\r\n--B\r\n\r\ntwo\r\n--B--\r\nepilogue');
    expect(splitMultipart(body, 'B').map((p) => p.toString())).toEqual(['Content-Type: text/plain\r\n\r\none', '\r\ntwo']);
    expect(splitMultipart(Buffer.from('no delimiter here'), 'B')).toEqual([]);
  });
});
