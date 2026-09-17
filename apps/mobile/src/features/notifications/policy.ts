import { routeForPushData } from './routing';

/**
 * The two decisions about notifications that are worth arguing over, kept as
 * pure functions so the argument can be settled by a test: *when* to ask a
 * technician for permission, and what to do with one that arrives while they
 * are holding the phone.
 */

/* ------------------------------------------------------------- permission */

/**
 * How many signed-in opens have to have happened before the app asks.
 *
 * Not on the first one. A technician who has just installed this and signed in
 * has no idea yet what it is; an OS dialog at that moment is a question about
 * nothing, and on iOS it is the *only* one they will ever get — deny it and
 * the app can never ask again, only send them to Settings. So the app waits
 * until they have opened it, used it, and come back. By then "BitCRM would
 * like to send you notifications" is a question about a thing they recognise.
 */
export const ASK_AFTER_OPENS = 2;

export interface PermissionSnapshot {
  /** The OS's answer today. */
  granted: boolean;
  /** False once the technician has said no — iOS will not show a second one. */
  canAskAgain: boolean;
}

export interface AskInputs {
  /** Signed-in app opens on this device, this one included. */
  opens: number;
  /** Whether this app has ever put the OS prompt in front of them. */
  alreadyAsked: boolean;
  permission: PermissionSnapshot;
}

export type AskDecision =
  /** Permission is already there; register the token and say nothing. */
  | 'already-granted'
  /** Put the OS prompt up now. */
  | 'ask'
  /** Too early — they have not used the app enough to be asked yet. */
  | 'wait'
  /** They said no, or the OS is done asking. Their answer stands. */
  | 'never';

export function permissionDecision({
  opens,
  alreadyAsked,
  permission,
}: AskInputs): AskDecision {
  if (permission.granted) return 'already-granted';
  // Not being allowed to ask again is the OS telling us this was settled.
  // Asking anyway is impossible; nagging around it is just rude.
  if (!permission.canAskAgain) return 'never';
  if (alreadyAsked) return 'never';
  return opens >= ASK_AFTER_OPENS ? 'ask' : 'wait';
}

/* -------------------------------------------------------------- foreground */

/**
 * `expo-notifications` calls this the notification's "behavior": what the OS
 * does with one that lands while the app is in the foreground.
 */
export interface ForegroundBehavior {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

/**
 * What to do with a notification that arrives while the technician is looking
 * at the phone.
 *
 * Never anything that takes the screen. A technician on a customer's doorstep,
 * mid-note, or reading an address does not get interrupted, and nothing here
 * navigates — a tap navigates, and a tap is a different event
 * (`addNotificationResponseReceivedListener`). A quiet banner they can ignore
 * is the whole of it.
 *
 * No sound either. The phone is already in their hand: the OS plays the sound
 * when the app is in the background, which is the case where a sound is the
 * only thing that would reach them.
 *
 * And nothing at all when it is about the screen they are already on — a
 * banner saying "new message" over the very thread showing that message is
 * noise, and covers the thing it is announcing.
 */
export function foregroundBehavior(
  data: unknown,
  currentPath: string | undefined,
): ForegroundBehavior {
  const target = routeForPushData(data);
  const alreadyThere = Boolean(target && currentPath && samePlace(target, currentPath));

  if (alreadyThere) {
    return {
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  }

  return {
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    // A badge number this app cannot count would be a number that is wrong.
    shouldSetBadge: false,
  };
}

/** Two paths pointing at the same screen, trailing slashes and all. */
function samePlace(a: string, b: string): boolean {
  const trim = (p: string) => p.replace(/\/+$/, '') || '/';
  return trim(a) === trim(b);
}
