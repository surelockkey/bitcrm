import type { LocationPoint } from './api';
import { shouldSendFix, type LastSent } from './policy';

/**
 * The thing between the GPS and the network.
 *
 * Every reading the phone produces is offered to it; it decides which ones are
 * worth a request (`policy.ts`) and remembers what actually left. Pulled out of
 * the provider so the rate, the retry and the ordering are testable without a
 * GPS, a timer or a React tree.
 *
 * Location points are deliberately **not** put on the offline outbox, unlike
 * every other write in this app. A position is a statement about right now: a
 * fix that leaves a basement forty minutes late would put a technician's pin
 * somewhere they no longer are, which is worse for dispatch than no pin at all.
 * This is the same call `markDealSeen` makes for the same reason
 * (`features/jobs/api.ts`) — a moment that missed its moment is better lost.
 */

export interface LocationSenderDeps {
  send: (point: LocationPoint) => Promise<unknown>;
  /** Take the stored fix down. Queued behind anything already in the air. */
  clear: () => Promise<unknown>;
  now?: () => number;
}

export interface LocationSender {
  /** Resolves true when this reading actually went to the server. */
  offer: (point: LocationPoint) => Promise<boolean>;
  /**
   * Stop sharing: wait for whatever is in flight, then remove the stored fix.
   *
   * The waiting is the point. A reading is read off the GPS while the clock is
   * still running but lands whenever the network allows, and the technician can
   * clock out in between. Sent after the delete, it puts the pin back — and the
   * server keeps that fix with no expiry at all
   * (`technician-location.service.ts`), so "I clocked out" would leave a
   * position on the dispatch map until somebody else moved it.
   */
  clear: () => Promise<void>;
  /** Forget what was sent — a new shift starts with a fix that always goes. */
  reset: () => void;
  lastSentAt: () => number | null;
}

export function createLocationSender({
  send,
  clear: clearFix,
  now = Date.now,
}: LocationSenderDeps): LocationSender {
  let last: LastSent | null = null;
  /**
   * What this sender currently has on the wire — a fix or the delete — already
   * caught, so awaiting it cannot throw and cannot go unhandled.
   */
  let inFlight: Promise<unknown> | null = null;

  /** Own the wire until `work` settles, so nothing can overtake it. */
  async function hold<T>(work: () => Promise<T>): Promise<T> {
    const running = work();
    const quiet = running.catch(() => undefined);
    inFlight = quiet;
    try {
      return await running;
    } finally {
      if (inFlight === quiet) inFlight = null;
    }
  }

  return {
    async offer(point) {
      // A request still in the air means the previous reading — or the delete
      // that has just taken the pin down — is in front of this one. Two
      // positions crossing on a slow connection can land out of order, and the
      // map would show the older one as current.
      if (inFlight) return false;
      if (!shouldSendFix(last, point, now())) return false;

      try {
        await hold(() => send(point));
        last = { point, at: now() };
        return true;
      } catch {
        // Nothing is recorded as sent, so the next reading is judged against
        // the last one that really landed: a technician driving out of a dead
        // spot reports immediately rather than waiting out a heartbeat.
        return false;
      }
    },
    async clear() {
      const previous = inFlight;
      // Nothing may be counted as sent afterwards: the next shift's first fix
      // has to go out at once, or the technician is missing from the map until
      // a heartbeat five minutes later.
      last = null;
      await hold(async () => {
        await previous;
        await clearFix();
      }).catch(() => {
        // A delete that will not go through is not worth interrupting anybody
        // over; the next fix of the next shift overwrites the pin anyway.
      });
    },
    reset() {
      last = null;
    },
    lastSentAt: () => last?.at ?? null,
  };
}
