/**
 * Runtime configuration. Expo inlines `EXPO_PUBLIC_*` vars into the bundle at
 * build time, mirroring the web app's `NEXT_PUBLIC_*` convention.
 */

/** The shared dev gateway — what the app talks to unless told otherwise. */
export const DEFAULT_API_BASE_URL = 'https://api.bitcrm.tech-slk.com/api';

/**
 * Accept the base URL the way a person types it into `.env.local`.
 *
 * Every service lives under the gateway's `/api` prefix (nginx routes
 * `/api/users`, `/api/deals`, … — see docs/ARCHITECTURE.md §1.0), and calling
 * code writes paths as `/deals/…`. So the `/api` suffix is added when it is
 * missing: someone testing against their laptop writes
 * `http://192.168.1.20:4000` and it works, rather than 404-ing an hour later.
 */
export function normalizeApiBaseUrl(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return DEFAULT_API_BASE_URL;
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (!withoutTrailingSlash) return DEFAULT_API_BASE_URL;
  return /\/api$/i.test(withoutTrailingSlash)
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api`;
}

const apiBaseUrl = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);

export const env = {
  /**
   * Base URL of the BitCRM API gateway. Requests hit
   * `${apiBaseUrl}/{users,crm,deals,inventory,telephony,messaging}/...`.
   */
  apiBaseUrl,
  /** True when the app is pointed somewhere other than the shared gateway. */
  usingApiOverride: apiBaseUrl !== DEFAULT_API_BASE_URL,
} as const;
