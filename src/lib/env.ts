/**
 * Runtime configuration. Expo inlines `EXPO_PUBLIC_*` vars into the bundle at
 * build time, mirroring the web app's `NEXT_PUBLIC_*` convention.
 */

/**
 * The shared dev gateway.
 *
 * A **development** convenience only: `expo start` with no `.env.local` talks
 * to it so a new checkout runs. It is deliberately not a fallback for a
 * release build — inlining happens at build time, so a release built without
 * `EXPO_PUBLIC_API_BASE_URL` in the environment would ship silently pointed at
 * dev, with no request failing to give it away.
 */
export const DEV_API_BASE_URL = 'https://api.bitcrm.tech-slk.com/api';

export const MISSING_API_BASE_URL =
  'EXPO_PUBLIC_API_BASE_URL was not set when this build was made. A release build must be told which gateway to talk to; see .env.example.';

/**
 * Accept the base URL the way a person types it into `.env.local`.
 *
 * Every service lives under the gateway's `/api` prefix (nginx routes
 * `/api/users`, `/api/deals`, … — see docs/ARCHITECTURE.md §1.0), and calling
 * code writes paths as `/deals/…`. So the `/api` suffix is added when it is
 * missing: someone testing against their laptop writes
 * `http://192.168.1.20:4000` and it works, rather than 404-ing an hour later.
 *
 * Returns null for "nothing was configured" — the caller decides what that
 * means, and it means different things in a dev build and a release one.
 */
export function normalizeApiBaseUrl(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  return /\/api$/i.test(trimmed) ? trimmed : `${trimmed}/api`;
}

/**
 * Which gateway this build talks to, and whether it was allowed not to say.
 *
 * In development, silence means the shared dev gateway. In a release build
 * silence is a mistake that has already happened — the value was needed when
 * the bundle was made — so it is raised at the first import rather than
 * discovered weeks later by a technician whose jobs are all somebody's test
 * data.
 */
export function resolveApiBaseUrl(
  raw: string | undefined | null,
  { dev }: { dev: boolean },
): string {
  const configured = normalizeApiBaseUrl(raw);
  if (configured) return configured;
  if (!dev) throw new Error(MISSING_API_BASE_URL);
  return DEV_API_BASE_URL;
}

const dev = __DEV__;
const apiBaseUrl = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, { dev });

export const env = {
  /**
   * Base URL of the BitCRM API gateway. Requests hit
   * `${apiBaseUrl}/{users,crm,deals,inventory,telephony,messaging}/...`.
   */
  apiBaseUrl,
  /** What kind of build this is, which is what the Profile screen warns off. */
  name: dev ? ('development' as const) : ('production' as const),
  /**
   * True when this build talks to the shared dev gateway — whoever built it
   * and however they meant it. The old flag was the inverse ("not the default
   * constant"), which read as a warning in exactly the case that needed none
   * and stayed silent in the case that did.
   */
  usingDevGateway: apiBaseUrl === DEV_API_BASE_URL,
} as const;
