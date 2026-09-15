import { buildMimeMessage, encodeHeaderValue } from '../../../src/email/mime/mime-builder';

const boundaries = () => {
  let n = 0;
  return () => `B${++n}`;
};

describe('buildMimeMessage', () => {
  it('writes multipart/mixed with an alternative part and base64 attachments', () => {
    const raw = buildMimeMessage({
      from: '"Sure Lock" <office@example.com>',
      to: ['jane@example.com'],
      cc: ['boss@example.com'],
      replyTo: 'c-c1@reply.example.com',
      subject: 'Invoice #12',
      text: 'Hello Jane',
      html: '<p>Hello <b>Jane</b></p>',
      inReplyTo: '<abc@mail.example.com>',
      references: ['<root@mail.example.com>', '<abc@mail.example.com>'],
      attachments: [{ fileName: 'invoice.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 fake') }],
      boundary: boundaries(),
    }).toString('utf8');

    const lines = raw.split('\r\n');
    expect(lines.slice(0, 10)).toEqual([
      'From: "Sure Lock" <office@example.com>',
      'To: jane@example.com',
      'Cc: boss@example.com',
      'Reply-To: c-c1@reply.example.com',
      'Subject: Invoice #12',
      'In-Reply-To: <abc@mail.example.com>',
      'References: <root@mail.example.com> <abc@mail.example.com>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="B1"',
      '',
    ]);
    expect(raw).toContain('--B1\r\nContent-Type: multipart/alternative; boundary="B2"');
    expect(raw).toContain('--B2\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + Buffer.from('Hello Jane').toString('base64'));
    expect(raw).toContain('--B2\r\nContent-Type: text/html; charset=UTF-8');
    expect(raw).toContain(Buffer.from('<p>Hello <b>Jane</b></p>').toString('base64'));
    expect(raw).toContain('--B2--');
    expect(raw).toContain(
      '--B1\r\nContent-Type: application/pdf; name="invoice.pdf"\r\nContent-Disposition: attachment; filename="invoice.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
        Buffer.from('%PDF-1.4 fake').toString('base64'),
    );
    expect(raw.endsWith('--B1--\r\n')).toBe(true);
    // every line fits SMTP
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(998);
  });

  it('skips the alternative wrapper for a text-only mail and omits empty headers', () => {
    const raw = buildMimeMessage({ from: 'a@b.co', to: ['c@d.co'], subject: 'Hi', text: 'plain', boundary: boundaries() }).toString('utf8');
    expect(raw).not.toContain('multipart/alternative');
    expect(raw).not.toContain('Cc:');
    expect(raw).not.toContain('Reply-To:');
    expect(raw).not.toContain('In-Reply-To:');
    expect(raw).toContain('--B1\r\nContent-Type: text/plain; charset=UTF-8');
  });

  it('wraps long base64 bodies at 76 characters', () => {
    const raw = buildMimeMessage({ from: 'a@b.co', to: ['c@d.co'], subject: 'x', text: 'y'.repeat(500), boundary: boundaries() }).toString('utf8');
    const body = raw.split('\r\n\r\n')[2].split('\r\n--B1--')[0];
    for (const line of body.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('encodes non-ASCII subjects and file names the RFC 2047 way', () => {
    expect(encodeHeaderValue('Plain subject')).toBe('Plain subject');
    expect(encodeHeaderValue('Ключ від дверей')).toBe(`=?UTF-8?B?${Buffer.from('Ключ від дверей', 'utf8').toString('base64')}?=`);
    expect(encodeHeaderValue('Line\r\nInjected: x')).toBe('Line Injected: x');
    const raw = buildMimeMessage({
      from: 'a@b.co',
      to: ['c@d.co'],
      subject: 'Договір',
      text: 'x',
      attachments: [{ fileName: 'договір.pdf', contentType: 'application/pdf', content: Buffer.from('x') }],
      boundary: boundaries(),
    }).toString('utf8');
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('filename="=?UTF-8?B?');
  });
});
