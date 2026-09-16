import { type SendToTechChannel } from '../entities/deal.entity';

/**
 * Typed slice of the `deal-events` SNS topic (publisher: deal-service).
 * Most deal events are still published as ad-hoc payloads documented in
 * `backend/EVENTS.md`; the ones consumed by another service with a fixed
 * shape are pinned here so publisher and consumer import the same contract.
 */
export const DEAL_EVENT_TOPIC = 'deal-events' as const;

export const DealEventType = {
  /** A dispatcher pressed "Send to tech" — messaging delivers the job text per channel. */
  SENT_TO_TECH: 'deal.sent_to_tech',
} as const;

export type DealEventType = (typeof DealEventType)[keyof typeof DealEventType];

// --- Payloads ---

/**
 * `deal.sent_to_tech` — one event per click, however many technicians and
 * channels were picked. `sentAt` is the idempotency key the consumer uses
 * per (deal, technician, channel): a redelivery of the same event sends
 * nothing twice, a later click (new `sentAt`) sends again.
 */
export interface DealSentToTechEvent {
  dealId: string;
  /** Human-facing Job ID, for the message subject / log lines. */
  dealNumber?: string;
  /** The technicians to notify — a subset of the roster at click time. */
  techIds: string[];
  channels: SendToTechChannel[];
  /** ISO-8601; equals the deal's `sentToTechAt` after this click. */
  sentAt: string;
  /** The dispatcher who pressed the button. */
  sentBy: string;
}
