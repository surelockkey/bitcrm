/**
 * A minimal RFC 5322 / 2045–2047 / 2231 reader for the mails SES stores in
 * S3 (design §5, variant A, M18). `mailparser` is not in the workspace, so
 * this covers what an inbox needs and nothing more: header unfolding and
 * encoded-word decoding, nested multipart, base64 / quoted-printable
 * transfer encodings, charset decoding through `TextDecoder`, address lists,
 * threading ids, and the attachments as buffers. Known gaps: no S/MIME, no
 * uuencode, no `message/partial`, inline `cid:` images become plain
 * attachments (the HTML keeps its `cid:` references).
 */
export interface ParsedAddress {
  name?: string;
  /** Lowercase. */
  address: string;
}

export interface ParsedAttachment {
  fileName: string;
  contentType: string;
  content: Buffer;
  contentId?: string;
  /** `Content-Disposition: inline` (typically an image the HTML references by `cid:`). */
  inline: boolean;
}

export interface ParsedMail {
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  from?: ParsedAddress;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  subject?: string;
  /** ISO-8601 when the `Date` header parses. */
  date?: string;
  text?: string;
  html?: string;
  attachments: ParsedAttachment[];
  /** Every header, name lowercased, values unfolded and in order of appearance. */
  headers: Map<string, string[]>;
}

interface MimeHeaders {
  get(name: string): string | undefined;
  all: Map<string, string[]>;
}

interface ContentType {
  type: string;
  params: Record<string, string>;
}

// ---------------------------------------------------------------- headers

/** Splits a raw message (or part) into unfolded headers and the body bytes. */
function splitHeaders(raw: Buffer): { headers: MimeHeaders; body: Buffer } {
  let end = -1;
  let bodyStart = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0a) {
      const crlf = i > 0 && raw[i - 1] === 0x0d;
      const next = raw[i + 1];
      if (next === 0x0a) {
        end = crlf ? i - 1 : i;
        bodyStart = i + 2;
        break;
      }
      if (next === 0x0d && raw[i + 2] === 0x0a) {
        end = crlf ? i - 1 : i;
        bodyStart = i + 3;
        break;
      }
    }
  }
  const headerText = end < 0 ? raw.toString('latin1') : raw.subarray(0, end).toString('latin1');
  const body = end < 0 ? Buffer.alloc(0) : raw.subarray(bodyStart);
  return { headers: parseHeaders(headerText), body };
}

function parseHeaders(text: string): MimeHeaders {
  const all = new Map<string, string[]>();
  const lines = text.split(/\r?\n/);
  let current: { name: string; value: string } | null = null;
  const flush = () => {
    if (!current) return;
    const list = all.get(current.name) ?? [];
    list.push(current.value.trim());
    all.set(current.name, list);
    current = null;
  };
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current) {
      current.value += ' ' + line.trim();
      continue;
    }
    flush();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    current = { name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1) };
  }
  flush();
  return { get: (name) => all.get(name.toLowerCase())?.[0], all };
}

/** `type/subtype; a=b; c="d"` → lowercase type + params (RFC 2231 continuations and charsets folded in). */
export function parseContentType(value: string | undefined, fallback = 'text/plain'): ContentType {
  if (!value) return { type: fallback, params: {} };
  const [head, ...rest] = value.split(';');
  const params: Record<string, string> = {};
  const continued: Record<string, { encoded: boolean; parts: Array<[number, string]> }> = {};
  for (const segment of rest) {
    const eq = segment.indexOf('=');
    if (eq < 0) continue;
    let name = segment.slice(0, eq).trim().toLowerCase();
    let raw = segment.slice(eq + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1).replace(/\\(.)/g, '$1');
    // `name*=` (encoded), `name*0=` (continued), `name*0*=` (continued and encoded) — RFC 2231.
    const cont = /^([^*]+)\*(\d+)?(\*)?$/.exec(name);
    if (cont) {
      name = cont[1];
      const entry = (continued[name] ??= { encoded: false, parts: [] });
      if (cont[3] !== undefined || cont[2] === undefined) entry.encoded = true;
      entry.parts.push([cont[2] === undefined ? 0 : Number(cont[2]), raw]);
      continue;
    }
    params[name] = raw;
  }
  for (const [name, entry] of Object.entries(continued)) {
    const joined = entry.parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join('');
    params[name] = entry.encoded ? decodeRfc2231(joined) : joined;
  }
  return { type: head.trim().toLowerCase() || fallback, params };
}

/** `UTF-8''caf%C3%A9.pdf` → `café.pdf`. */
function decodeRfc2231(value: string): string {
  const m = /^([^']*)'[^']*'(.*)$/.exec(value);
  if (!m) return value;
  const charset = m[1] || 'utf-8';
  const bytes = Buffer.from(m[2].replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
  return decodeCharset(bytes, charset);
}

// ---------------------------------------------------------- encoded words

const ENCODED_WORD = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;

/** RFC 2047: `=?charset?B|Q?…?=` runs in a header value; whitespace between two encoded words is dropped. */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/(\?=)[ \t\r\n]+(=\?)/g, '$1$2')
    .replace(ENCODED_WORD, (_, charset: string, enc: string, text: string) => {
      const bytes =
        enc.toLowerCase() === 'b'
          ? Buffer.from(text, 'base64')
          : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return decodeCharset(bytes, charset);
    });
}

// --------------------------------------------------------------- charsets

const CHARSET_ALIASES: Record<string, string> = {
  'us-ascii': 'latin1',
  ascii: 'latin1',
  'iso-8859-1': 'latin1',
  latin1: 'latin1',
  'utf8': 'utf-8',
  'unicode-1-1-utf-8': 'utf-8',
};

export function decodeCharset(bytes: Buffer, charset: string | undefined): string {
  const label = (charset ?? 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  const alias = CHARSET_ALIASES[label] ?? label;
  if (alias === 'latin1') return bytes.toString('latin1');
  try {
    return new TextDecoder(alias).decode(bytes);
  } catch {
    // Unknown label (or ICU without it): UTF-8 first, latin1 when that is not valid UTF-8.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return bytes.toString('latin1');
    }
  }
}

// -------------------------------------------------------- transfer encoding

export function decodeQuotedPrintable(body: Buffer): Buffer {
  const text = body.toString('latin1').replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '=' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(text.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function decodeTransfer(body: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? '7bit').trim().toLowerCase()) {
    case 'base64':
      return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    case 'quoted-printable':
      return decodeQuotedPrintable(body);
    default:
      return body;
  }
}

// -------------------------------------------------------------- addresses

/** Splits a header list on commas that are outside quotes and angle brackets. */
function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') depth++;
    else if (!quoted && ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && !quoted && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

const EMAIL = /[^\s<>"',;]+@[^\s<>"',;]+/;

export function parseAddress(value: string): ParsedAddress | undefined {
  const decoded = decodeEncodedWords(value).trim();
  const angle = /^(.*?)<([^>]+)>\s*$/.exec(decoded);
  if (angle) {
    const address = angle[2].trim().toLowerCase();
    if (!EMAIL.test(address)) return undefined;
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim() || undefined;
    return { name, address };
  }
  const bare = EMAIL.exec(decoded);
  return bare ? { address: bare[0].toLowerCase() } : undefined;
}

export function parseAddressList(value: string | undefined): ParsedAddress[] {
  if (!value) return [];
  return splitAddressList(value)
    .map(parseAddress)
    .filter((a): a is ParsedAddress => !!a);
}

const normaliseMessageId = (value: string | undefined): string | undefined => {
  const m = value && /<([^<>]+)>/.exec(value);
  if (m) return `<${m[1].trim()}>`;
  const bare = value?.trim();
  return bare ? `<${bare}>` : undefined;
};

const parseReferences = (value: string | undefined): string[] =>
  (value?.match(/<[^<>]+>/g) ?? []).map((id) => id.trim());

// -------------------------------------------------------------- the walk

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/csv': 'csv',
  'message/rfc822': 'eml',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const fallbackFileName = (index: number, contentType: string) =>
  `attachment-${index}.${EXTENSIONS[contentType] ?? contentType.split('/')[1]?.replace(/[^a-z0-9]+/gi, '') ?? 'bin'}`;

interface Collector {
  text: string[];
  html: string[];
  attachments: ParsedAttachment[];
}

function walk(raw: Buffer, collector: Collector, depth: number, inheritedType?: string): void {
  const { headers, body } = splitHeaders(raw);
  const ct = parseContentType(headers.get('content-type'), inheritedType ?? 'text/plain');
  const disposition = parseContentType(headers.get('content-disposition'), '');
  const isAttachment = disposition.type === 'attachment';
  const isInline = disposition.type === 'inline';

  if (ct.type.startsWith('multipart/') && ct.params.boundary && depth < 20) {
    // `multipart/digest` parts default to message/rfc822 (RFC 2046 §5.1.5).
    const childDefault = ct.type === 'multipart/digest' ? 'message/rfc822' : undefined;
    for (const part of splitMultipart(body, ct.params.boundary)) walk(part, collector, depth + 1, childDefault);
    return;
  }

  const decoded = decodeTransfer(body, headers.get('content-transfer-encoding'));
  const named = disposition.params.filename ?? ct.params.name;

  if ((ct.type === 'text/plain' || ct.type === 'text/html') && !isAttachment && !named) {
    const text = decodeCharset(decoded, ct.params.charset);
    (ct.type === 'text/plain' ? collector.text : collector.html).push(text);
    return;
  }

  const index = collector.attachments.length + 1;
  const fileName = named ? decodeEncodedWords(named) : fallbackFileName(index, ct.type);
  const contentId = headers.get('content-id')?.replace(/^<|>$/g, '').trim() || undefined;
  collector.attachments.push({ fileName, contentType: ct.type, content: decoded, contentId, inline: isInline });
}

/** The parts between `--boundary` delimiters; the preamble and epilogue are dropped. */
export function splitMultipart(body: Buffer, boundary: string): Buffer[] {
  const text = body.toString('latin1');
  const delimiter = `--${boundary}`;
  const parts: Buffer[] = [];
  let cursor = text.indexOf(delimiter);
  while (cursor >= 0) {
    const lineEnd = text.indexOf('\n', cursor);
    if (lineEnd < 0) break;
    const marker = text.slice(cursor + delimiter.length, lineEnd).replace(/\r$/, '');
    if (marker.startsWith('--')) break; // closing delimiter
    const start = lineEnd + 1;
    let next = text.indexOf(`\n${delimiter}`, start);
    let end: number;
    if (next < 0) {
      end = text.length;
      next = -1;
    } else {
      end = text[next - 1] === '\r' ? next - 1 : next;
    }
    parts.push(Buffer.from(text.slice(start, end), 'latin1'));
    cursor = next < 0 ? -1 : next + 1;
  }
  return parts;
}

export function parseMail(raw: Buffer): ParsedMail {
  const { headers } = splitHeaders(raw);
  const collector: Collector = { text: [], html: [], attachments: [] };
  walk(raw, collector, 0);

  const dateHeader = headers.get('date');
  const date = dateHeader ? new Date(dateHeader) : undefined;
  const subject = headers.get('subject');

  return {
    messageId: normaliseMessageId(headers.get('message-id')),
    inReplyTo: normaliseMessageId(headers.get('in-reply-to')),
    references: parseReferences(headers.get('references')),
    from: parseAddressList(headers.get('from'))[0],
    to: parseAddressList(headers.all.get('to')?.join(', ')),
    cc: parseAddressList(headers.all.get('cc')?.join(', ')),
    subject: subject === undefined ? undefined : decodeEncodedWords(subject).trim() || undefined,
    date: date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined,
    text: collector.text.length ? collector.text.join('\n').replace(/\r\n/g, '\n').trim() || undefined : undefined,
    html: collector.html.length ? collector.html.join('\n').trim() || undefined : undefined,
    attachments: collector.attachments,
    headers: headers.all,
  };
}
