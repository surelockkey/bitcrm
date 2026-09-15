/**
 * Delivery state of one message. Inbound messages are `received` and stay
 * there; outbound ones walk `queued → sending → sent → delivered|undelivered|
 * failed → read` as Twilio status callbacks arrive. Email adds `opened` and
 * `clicked` (Workiz `clickedClientPortalLink` → `clicked`).
 */
export const MESSAGE_STATUSES = [
  'received',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'read',
  'opened',
  'clicked',
  'canceled',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Monotonic rank (design §3.5): status callbacks arrive out of order, so a
 * write only applies when the incoming rank is strictly greater than the
 * stored one — a terminal state is never overwritten by another terminal
 * state, and `sent` arriving after `delivered` is ignored. Stored on the
 * message as `statusRank` so the guard is a DynamoDB condition, not a read.
 */
export const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  received: 0,
  queued: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  undelivered: 3,
  failed: 3,
  canceled: 3,
  read: 4,
  opened: 4,
  clicked: 5,
};

/** Statuses after which the provider will not report anything else about delivery. */
export const TERMINAL_MESSAGE_STATUSES: readonly MessageStatus[] = [
  'delivered',
  'undelivered',
  'failed',
  'canceled',
];

export const isTerminalMessageStatus = (status: MessageStatus): boolean =>
  TERMINAL_MESSAGE_STATUSES.includes(status);

/** Whether a status callback carrying `next` may overwrite `current`. */
export const canAdvanceMessageStatus = (
  current: MessageStatus | undefined,
  next: MessageStatus,
): boolean =>
  current === undefined || MESSAGE_STATUS_RANK[next] > MESSAGE_STATUS_RANK[current];
