/** Workiz writes `incomming` / `outgoing`; BitCRM normalises to these. */
export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
