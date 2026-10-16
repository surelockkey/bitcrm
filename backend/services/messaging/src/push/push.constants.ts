/**
 * Push notifications to the technician app (Expo push service). Everything
 * lives in the messaging table under its own prefixes — no index, no new
 * table:
 *
 *   PUSHTOKEN#<token>  / METADATA        the device token's ONE owner { token, userId, platform, createdAt, updatedAt }
 *   PUSHUSER#<userId>  / TOKEN#<token>   the same token under its owner — a user's devices in one Query
 *   PUSHSENT#<occurrence> / METADATA     "this event was already pushed" claim, TTL `expiresAt` (7 days)
 *
 * The first two rows are written and moved together (a sign-in on a shared
 * van phone hands the token to the new user), the third is a conditional Put
 * made once per event before anything is sent.
 */
export const pushTokenPk = (token: string) => `PUSHTOKEN#${token}`;
export const pushUserPk = (userId: string) => `PUSHUSER#${userId}`;
export const PUSH_USER_TOKEN_SK_PREFIX = 'TOKEN#';
export const pushUserTokenSk = (token: string) => `${PUSH_USER_TOKEN_SK_PREFIX}${token}`;
export const pushSentPk = (occurrence: string) => `PUSHSENT#${occurrence}`;
/** Long past any SQS redelivery (4-day retention) — then DynamoDB sweeps the claim. */
export const PUSH_SENT_TTL_SECONDS = 7 * 24 * 60 * 60;

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** `ExponentPushToken[…]` (what `getExpoPushTokenAsync` returns) or the newer `ExpoPushToken[…]`. */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[^[\]\s]+\]$/;
export const EXPO_PUSH_TOKEN_MAX_LENGTH = 255;

/** What the phone routes a tap on (`data.type`) — the contract with the app. */
export const PUSH_TYPES = ['job_assigned', 'job_rescheduled', 'job_canceled', 'job_unassigned', 'message'] as const;
export type PushType = (typeof PUSH_TYPES)[number];

/** The `data` of every notification — the app opens the job or the thread from it. */
export interface PushData {
  type: PushType;
  dealId?: string;
  conversationId?: string;
}
