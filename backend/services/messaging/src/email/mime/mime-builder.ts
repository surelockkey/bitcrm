import { randomBytes } from 'node:crypto';

/**
 * A small RFC 2045/5322 writer for the one shape the sender needs when a
 * mail carries attachments inline (SES `Content.Raw`):
 *
 *   multipart/mixed
 *     multipart/alternative
 *       text/plain (base64, UTF-8)
 *       text/html  (base64, UTF-8)
 *     application/… (base64, attachment)
 *
 * Everything user-supplied is base64-encoded, so line length and 8-bit
 * content never matter; header values are RFC 2047 encoded when they carry
 * anything outside ASCII. `Message-ID` and `Date` are left to SES, which
 * overwrites them anyway.
 */
export interface MimeAttachment {
  fileName: string;
  contentType: string;
  content: Buffer;
}

export interface MimeMessageInput {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: MimeAttachment[];
  /** Injectable for deterministic tests. */
  boundary?: () => string;
}

const CRLF = '\r\n';

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 `=?UTF-8?B?…?=` for a header value that is not plain ASCII. */
export function encodeHeaderValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ');
  return isAscii(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/** RFC 2231-free filename: quoted, with non-ASCII encoded the RFC 2047 way (what mail clients actually read). */
const fileNameParam = (fileName: string) => `"${encodeHeaderValue(fileName).replace(/"/g, "'")}"`;

const base64Lines = (buf: Buffer) => (buf.toString('base64').match(/.{1,76}/g) ?? []).join(CRLF);

export function buildMimeMessage(input: MimeMessageInput): Buffer {
  const boundary = input.boundary ?? (() => `----=_bitcrm_${randomBytes(12).toString('hex')}`);
  const mixed = boundary();
  const alternative = boundary();

  const headers: string[] = [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(', ')}`] : []),
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Subject: ${encodeHeaderValue(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references?.length ? [`References: ${input.references.join(' ')}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];

  const textPart = [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(input.text, 'utf8')),
  ].join(CRLF);
  const htmlPart = input.html
    ? [
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(Buffer.from(input.html, 'utf8')),
      ].join(CRLF)
    : undefined;

  const body = htmlPart
    ? [
        `Content-Type: multipart/alternative; boundary="${alternative}"`,
        '',
        `--${alternative}`,
        textPart,
        `--${alternative}`,
        htmlPart,
        `--${alternative}--`,
      ].join(CRLF)
    : textPart;

  const parts: string[] = [body];
  for (const a of input.attachments ?? []) {
    parts.push(
      [
        `Content-Type: ${a.contentType}; name=${fileNameParam(a.fileName)}`,
        `Content-Disposition: attachment; filename=${fileNameParam(a.fileName)}`,
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(a.content),
      ].join(CRLF),
    );
  }

  const message =
    headers.join(CRLF) +
    CRLF +
    CRLF +
    parts.map((p) => `--${mixed}${CRLF}${p}`).join(CRLF) +
    CRLF +
    `--${mixed}--` +
    CRLF;
  return Buffer.from(message, 'utf8');
}
