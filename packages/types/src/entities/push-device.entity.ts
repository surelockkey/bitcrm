/**
 * The device / push contract, shared because both halves have to agree on it
 * byte for byte: messaging-service writes these rows and builds these
 * payloads, the technician app (`apps/mobile`, which reaches this package
 * through `file:../../packages/types`) registers the token and reads the
 * payload back out of the notification it was tapped from.
 */

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/**
 * One phone a user is signed in on — `DEVICE#<token>` / `METADATA` in the
 * messaging table. The token is Expo's (`ExponentPushToken[…]`), which is
 * why nothing here knows about APNs or FCM keys.
 */
export interface PushDevice {
  /** Expo push token; the row's identity, so one token belongs to one user. */
  token: string;
  /** Who the phone is signed in as — re-registering under another user moves it. */
  userId: string;
  platform: PushPlatform;
  /** App build, for reading the logs when one version misbehaves. */
  appVersion?: string;
  /** "Ihor's iPhone" — what a person recognises in a device list. */
  deviceName?: string;
  /** First registration of this token; kept across refreshes. */
  registeredAt: string;
  /** Every registration refreshes this, and with it the row's TTL. */
  lastSeenAt: string;
}

/** `POST /api/messaging/devices` answers with this. */
export interface PushDeviceRegistration {
  token: string;
  registeredAt: string;
}

/** A job was sent to the technician — the app opens that job's card. */
export interface JobPushData {
  kind: 'job';
  dealId: string;
}

/** A new message the user should see — the app opens that thread. */
export interface ConversationPushData {
  kind: 'conversation';
  conversationId: string;
  messageId: string;
}

/**
 * The `data` of an Expo push message. The app switches on `kind` to decide
 * where a tap lands; nothing else in the payload is addressed to a person,
 * so every id stays out of the visible title and body.
 */
export type PushNotificationData = JobPushData | ConversationPushData;
