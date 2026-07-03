/**
 * Typed access to public runtime configuration.
 * Only `NEXT_PUBLIC_*` vars are available in the browser bundle.
 */
const DEFAULT_API_BASE_URL = "https://api.bitcrm.tech-slk.com/api";

export const env = {
  /**
   * Base URL of the BitCRM API gateway. Requests are made to
   * `${apiBaseUrl}/{users,crm,deals,inventory}/...`.
   */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
} as const;

if (
  process.env.NODE_ENV !== "production" &&
  !process.env.NEXT_PUBLIC_API_BASE_URL
) {
  console.warn(
    `[env] NEXT_PUBLIC_API_BASE_URL is not set — falling back to ${DEFAULT_API_BASE_URL}`,
  );
}
