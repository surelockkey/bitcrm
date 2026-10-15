import { type DealForCall } from './deal-read.service';

/** The client's numbers as `ContactLookupService.phonesOf` reads them. */
export interface ClientPhones {
  phones: string[];
  /** What to press once answered, keyed by the number it belongs to. */
  extensions?: Record<string, string>;
}

/** One number a masked call can ring, and what to press once it answers. */
export interface ClientLine {
  /** The real E.164. Never leaves the server. */
  to: string;
  extension?: string;
}

/**
 * The client number at a position on the job — THE order both ways into a
 * masked call use (the in-app bridge's `phoneIndex` and the dial-in code
 * minted for a position), so "the second number" can never mean two
 * different numbers.
 *
 * Position 0 is the job's own first number when it has one ("This job only"),
 * else the client's first; every other position is the client's own. Null
 * when nothing is at that position any more — a number removed after its code
 * was printed.
 *
 * The extension is the one keyed by the number actually dialled, else — for
 * position 0 only — the client's first number's, which is the one the job
 * page shows on that line.
 */
export function clientLineAt(
  deal: Pick<DealForCall, 'clientPhone'>,
  client: ClientPhones | null | undefined,
  index: number,
): ClientLine | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const phones = client?.phones ?? [];
  const to = (index === 0 && deal.clientPhone) || phones[index];
  if (!to) return null;

  const extensions = client?.extensions ?? {};
  const extension = extensions[to] || (index === 0 && phones[0] ? extensions[phones[0]] : undefined);
  return extension ? { to, extension } : { to };
}

/** How many positions the job's client has — the job's own number counts when the client has none. */
export function clientLineCount(
  deal: Pick<DealForCall, 'clientPhone'>,
  client: ClientPhones | null | undefined,
): number {
  return Math.max(client?.phones?.length ?? 0, deal.clientPhone ? 1 : 0);
}

/** Twilio presses at most 32 keys. */
const MAX_SEND_KEYS = 32;
/**
 * A beat before the first key: an auto-attendant answers, then starts
 * listening. `w` is half a second.
 */
const LEAD_PAUSE = 'ww';

/**
 * An extension as Twilio's `sendDigits`: a pause, then the keys. Our stored
 * form allows `,` for a pause (`normalizeExtension`), which Twilio spells `W`
 * (one second). Undefined when there is nothing to press.
 */
export function extensionKeys(extension: string | undefined | null): string | undefined {
  const keys = (extension ?? '').replace(/[^0-9*#,]/g, '').replace(/,/g, 'W');
  if (!keys) return undefined;
  return `${LEAD_PAUSE}${keys}`.slice(0, MAX_SEND_KEYS);
}
