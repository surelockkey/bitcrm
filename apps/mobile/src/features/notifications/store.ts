import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The little the app has to remember about notifications between launches:
 * how many times this technician has opened it (so it knows when asking makes
 * sense), whether it has ever asked, and which push token the server currently
 * has for this phone.
 *
 * On disk rather than in the query cache because two of the three have to
 * survive a sign-out: the token so it can still be released, and the count so
 * the next technician on the same phone is not asked on their first open
 * either. Everything here is cheap and none of it is secret.
 */

const KEY = 'bitcrm.push.v1';

export interface PushState {
  /** Signed-in app opens seen on this device. */
  opens: number;
  /** Whether the OS permission prompt has ever been shown by this app. */
  asked: boolean;
  /** The Expo push token the server was last told about, if any. */
  token?: string;
}

export const EMPTY_PUSH_STATE: PushState = { opens: 0, asked: false };

/**
 * Read the record back, treating anything unreadable as "nothing yet".
 *
 * A half-written blob must not stop the app from starting, and the worst it
 * can cost is one early permission prompt.
 */
export async function loadPushState(): Promise<PushState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY_PUSH_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_PUSH_STATE;
    const { opens, asked, token } = parsed as Partial<PushState>;
    return {
      opens: typeof opens === 'number' && opens >= 0 ? opens : 0,
      asked: asked === true,
      ...(typeof token === 'string' && token ? { token } : {}),
    };
  } catch {
    return EMPTY_PUSH_STATE;
  }
}

/** Merge a change in. Never throws: a full disk must not break anything. */
export async function savePushState(patch: Partial<PushState>): Promise<PushState> {
  const current = await loadPushState();
  const next: PushState = { ...current, ...patch };
  // An explicit undefined means "forget this", which JSON.stringify drops.
  if (patch.token === undefined && 'token' in patch) delete next.token;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The in-memory answer is still right for this session.
  }
  return next;
}

/** One more signed-in open. Returns the new count. */
export async function recordAppOpen(): Promise<number> {
  const { opens } = await loadPushState();
  const next = opens + 1;
  await savePushState({ opens: next });
  return next;
}
