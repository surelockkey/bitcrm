/**
 * The push contract, as agreed with the backend stream.
 *
 * Two payloads, carried in an Expo push message's `data`. Neither side gets to
 * invent a third shape without the other:
 *
 *   a new message the user should see:
 *     { kind: 'conversation', conversationId: string, messageId: string }
 *   a job sent to the technician:
 *     { kind: 'job', dealId: string }
 *
 * And the endpoints that put this phone on the list:
 *
 *   POST   /api/messaging/devices
 *          { token, platform: 'ios' | 'android', appVersion?, deviceName? }
 *          -> { success: true, data: { token, registeredAt } }
 *   DELETE /api/messaging/devices/:token  -> { success: true, data: { token } }
 */

export interface ConversationPush {
  kind: 'conversation';
  conversationId: string;
  messageId: string;
}

export interface JobPush {
  kind: 'job';
  dealId: string;
}

export type PushPayload = ConversationPush | JobPush;

export type DevicePlatform = 'ios' | 'android';

export interface RegisterDeviceBody {
  token: string;
  platform: DevicePlatform;
  appVersion?: string;
  deviceName?: string;
}

export interface RegisteredDevice {
  token: string;
  registeredAt: string;
}

/**
 * What came of trying to put this phone on the list. Every branch is a state
 * the app has to keep working in, which is why this is a value rather than a
 * thrown error — see `device.ts`.
 */
export type RegistrationOutcome =
  /** On the list. `token` is what a later sign-out has to release. */
  | { status: 'registered'; token: string }
  /** The technician has not been asked yet, and it is not the moment to. */
  | { status: 'not-yet' }
  /** They said no, or the OS will not let us ask again. Their choice stands. */
  | { status: 'denied' }
  /**
   * Nothing is wrong with the app: this build or this device simply cannot
   * hold a push token. Expected on a simulator, in Expo Go, and in any build
   * made before the owner's Apple and Google accounts exist.
   */
  | { status: 'unavailable'; reason: UnavailableReason }
  /** The server refused the registration, or the phone could not reach it. */
  | { status: 'failed'; error: unknown };

export type UnavailableReason =
  /** A simulator has no push token to give — there is no device to push to. */
  | 'simulator'
  /**
   * No EAS project id in the app config, so Expo cannot mint a token. This is
   * the state of the app today and it is not a bug: the id arrives with the
   * owner's Expo account, alongside the APNs key and the FCM project.
   */
  | 'no-project-id'
  /**
   * Expo refused to mint one — Expo Go rather than a development build, or
   * credentials that do not exist yet.
   */
  | 'no-token';
