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
  now?: () => number;
}

export interface LocationSender {
  /** Resolves true when this reading actually went to the server. */
  offer: (point: LocationPoint) => Promise<boolean>;
  /** Forget what was sent — a new shift starts with a fix that always goes. */
  reset: () => void;
  lastSentAt: () => number | null;
}

export function createLocationSender({
  send,
  now = Date.now,
}: LocationSenderDeps): LocationSender {
  let last: LastSent | null = null;
  let inFlight = false;

  return {
    async offer(point) {
      // A request still in the air means the previous reading is in front of
      // this one. Two positions crossing on a slow connection can land out of
      // order, and the map would show the older one as current.
      if (inFlight) return false;
      if (!shouldSendFix(last, point, now())) return false;

      inFlight = true;
      try {
        await send(point);
        last = { point, at: now() };
        return true;
      } catch {
        // Nothing is recorded as sent, so the next reading is judged against
        // the last one that really landed: a technician driving out of a dead
        // spot reports immediately rather than waiting out a heartbeat.
        return false;
      } finally {
        inFlight = false;
      }
    },
    reset() {
      last = null;
    },
    lastSentAt: () => last?.at ?? null,
  };
}
