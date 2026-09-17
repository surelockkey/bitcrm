import { queryKeys } from '../../lib/api/query-keys';
import type { PushPayload } from './types';

/**
 * A notification's payload, and where tapping it should land.
 *
 * Pure on purpose: "what does tapping a job notification open?" has to be a
 * test, because the only other way to find out is to hold a phone with a
 * development build on it, which nobody can do until the owner's Apple and
 * Google accounts exist.
 */

/** Where the chat lands. */
const CHAT_PATH = '/chat';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

/**
 * Read a push payload off the wire.
 *
 * Anything that is not one of the two agreed shapes is `null`, and the caller
 * does nothing with it. A notification is the one input the app cannot type
 * check at the boundary — it is JSON, from a server, through two push services
 * — and a build one release older than the backend will meet a `kind` it has
 * never heard of. That must open the app and stop, never throw inside a tap
 * handler a technician is waiting on.
 */
export function parsePushPayload(data: unknown): PushPayload | null {
  if (!isRecord(data)) return null;

  switch (data.kind) {
    case 'job': {
      const dealId = str(data.dealId);
      return dealId ? { kind: 'job', dealId } : null;
    }
    case 'conversation': {
      const conversationId = str(data.conversationId);
      const messageId = str(data.messageId);
      return conversationId && messageId
        ? { kind: 'conversation', conversationId, messageId }
        : null;
    }
    default:
      return null;
  }
}

/**
 * The route a tap opens.
 *
 * A job goes to that job — the same path the day list pushes, so a technician
 * arrives exactly where they would have arrived by tapping the card, with the
 * tab bar behind them and Back working.
 *
 * A conversation goes to `/chat`. The chat screen itself is being built in
 * parallel by the messaging stream and lands with it; when it does, this is
 * where the `conversationId` starts being used to open that one thread rather
 * than the list. Until then the tap opens the app at the chat and stops, which
 * is the right behaviour for a build whose chat screen is not there yet.
 */
export function routeForPush(payload: PushPayload): string {
  switch (payload.kind) {
    case 'job':
      return `/jobs/${payload.dealId}`;
    case 'conversation':
      return CHAT_PATH;
  }
}

/** Where a notification would take us, or null if we cannot read it. */
export function routeForPushData(data: unknown): string | null {
  const payload = parsePushPayload(data);
  return payload ? routeForPush(payload) : null;
}

/**
 * What the arrival of this notification has just made out of date.
 *
 * A push is news, and the app is very often already showing the thing the news
 * is about: the day list, or that very job. Deciding whether to put a banner up
 * is only half an answer — a banner reading "your 2 o'clock moved to 4" over a
 * card that still says 2 o'clock is worse than no banner, and the quiet case
 * (the screen the technician is already on, where the banner is deliberately
 * suppressed) would otherwise tell them nothing at all.
 *
 * So arriving marks the affected queries stale. It still never navigates and
 * never takes the screen: the list under their thumb simply becomes right.
 *
 * A conversation has nothing to invalidate yet — no chat query exists on the
 * phone. Its keys belong here when the messaging stream's screen lands.
 */
export function staleKeysForPushData(data: unknown): readonly (readonly unknown[])[] {
  const payload = parsePushPayload(data);
  if (payload?.kind !== 'job') return [];
  // The card in the day list carries the same times and stamps as the job
  // itself, so both, or going back one screen undoes the correction.
  return [queryKeys.deals.lists(), queryKeys.deals.detail(payload.dealId)];
}
