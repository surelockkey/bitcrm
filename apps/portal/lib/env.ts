/** Public runtime configuration (`NEXT_PUBLIC_*` is inlined into the browser bundle). */
export const env = {
  /** BitCRM API base; requests go to `${apiBaseUrl}/billing/public/portal/…`. */
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.bitcrm.tech-slk.com/api").replace(/\/+$/, ""),
} as const;
