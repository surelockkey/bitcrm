/**
 * Runtime configuration. In Expo, `EXPO_PUBLIC_*` vars are inlined into the
 * app bundle, mirroring the web app's `NEXT_PUBLIC_*` convention.
 */
const DEFAULT_API_BASE_URL = 'https://api.bitcrm.tech-slk.com/api';

export const env = {
  /**
   * Base URL of the BitCRM API gateway. Requests hit
   * `${apiBaseUrl}/{users,crm,deals,inventory}/...`.
   */
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
} as const;
