import { tryNormalizePhone } from '@bitcrm/shared';

/**
 * The form Twilio posts to the inbound (and fallback) webhook, as documented
 * for the Messages API: `MessageSid`, `AccountSid`, `From`, `To`, `Body`,
 * `NumMedia` + `MediaUrl{N}` / `MediaContentType{N}`, `NumSegments`,
 * `MessagingServiceSid`, and `OptOutType` when Advanced Opt-Out matched a
 * keyword. Everything is a string; unknown keys are kept.
 */
export type TwilioInboundForm = Record<string, string | undefined>;

export type OptOutType = 'STOP' | 'START' | 'HELP';

export interface InboundMedia {
  index: number;
  url: string;
  contentType: string;
  /** `ME…` parsed out of the media URL. */
  providerMediaSid?: string;
}

/** What the inbound pipeline consumes, whichever way the message reached us. */
export interface InboundMessageInput {
  /** `SM…` / `MM…`. */
  providerSid: string;
  accountSid?: string;
  messagingServiceSid?: string;
  /** E.164. */
  from: string;
  /** E.164 — the company number the client wrote to. */
  to: string;
  body?: string;
  segments?: number;
  media: InboundMedia[];
  optOutType?: OptOutType;
  /**
   * When the message actually arrived at Twilio. The webhook leaves it unset
   * (now); reconciliation passes Twilio's `dateSent` so a back-filled line
   * lands in its historical place in the feed.
   */
  receivedAt?: string;
}

/** The payload cannot be turned into a message — answer 400, nothing to store. */
export class MalformedInboundPayloadError extends Error {
  constructor(public readonly reason: string) {
    super(`Malformed inbound payload: ${reason}`);
    this.name = 'MalformedInboundPayloadError';
  }
}

const MEDIA_SID_RE = /\/Media\/(ME[0-9a-fA-F]{32})/;
const OPT_OUT_TYPES: readonly OptOutType[] = ['STOP', 'START', 'HELP'];

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

export const providerMediaSidOf = (url: string): string | undefined =>
  MEDIA_SID_RE.exec(url)?.[1];

/**
 * Validates and normalises the webhook form (design §4.3 step 3): phone
 * numbers through `normalizePhone` so they match the CRM byte for byte,
 * `NumMedia` expanded into the media list, `OptOutType` narrowed to the
 * three values Twilio sends. Throws `MalformedInboundPayloadError` on
 * anything that cannot be a message.
 */
export function parseInboundPayload(raw: unknown): InboundMessageInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedInboundPayloadError('body is not a form');
  }
  const form = raw as TwilioInboundForm;

  const providerSid = str(form.MessageSid) ?? str(form.SmsSid);
  if (!providerSid) throw new MalformedInboundPayloadError('MessageSid missing');

  const rawFrom = str(form.From);
  const rawTo = str(form.To);
  if (!rawFrom) throw new MalformedInboundPayloadError('From missing');
  if (!rawTo) throw new MalformedInboundPayloadError('To missing');

  const from = tryNormalizePhone(rawFrom);
  const to = tryNormalizePhone(rawTo);
  if (!from) throw new MalformedInboundPayloadError(`From is not a phone number: ${rawFrom}`);
  if (!to) throw new MalformedInboundPayloadError(`To is not a phone number: ${rawTo}`);

  const numMedia = Number(str(form.NumMedia) ?? 0);
  const media: InboundMedia[] = [];
  for (let i = 0; i < (Number.isFinite(numMedia) ? numMedia : 0); i++) {
    const url = str(form[`MediaUrl${i}`]);
    if (!url) continue;
    media.push({
      index: i,
      url,
      contentType: str(form[`MediaContentType${i}`]) ?? 'application/octet-stream',
      providerMediaSid: providerMediaSidOf(url),
    });
  }

  const segments = Number(str(form.NumSegments));
  const optOutRaw = str(form.OptOutType)?.toUpperCase();

  return {
    providerSid,
    accountSid: str(form.AccountSid),
    messagingServiceSid: str(form.MessagingServiceSid),
    from,
    to,
    body: str(form.Body),
    segments: Number.isFinite(segments) && segments > 0 ? segments : undefined,
    media,
    optOutType: OPT_OUT_TYPES.find((t) => t === optOutRaw),
  };
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'audio/ogg': 'ogg',
  'text/vcard': 'vcf',
  'text/x-vcard': 'vcf',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

/** `ME…jpg` — a display name for media Twilio never named. */
export function mediaFileName(m: Pick<InboundMedia, 'index' | 'contentType' | 'providerMediaSid'>): string {
  const type = m.contentType.split(';')[0].trim().toLowerCase();
  const ext = EXTENSIONS[type] ?? type.split('/')[1]?.replace(/[^a-z0-9]+/g, '') ?? 'bin';
  return `${m.providerMediaSid ?? `media-${m.index}`}.${ext || 'bin'}`;
}
