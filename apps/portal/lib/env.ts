/** Public runtime configuration (`NEXT_PUBLIC_*` is inlined into the browser bundle). */
export const env = {
  /** BitCRM API base; requests go to `${apiBaseUrl}/billing/public/portal/…`. */
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.bitcrm.tech-slk.com/api").replace(/\/+$/, ""),
  /**
   * Optional fallback only. The publishable key normally rides back on the
   * payment session (`PortalPaymentSession.publishableKey`), so a portal build
   * needs no Stripe configuration of its own and one deployment can serve an
   * account whose keys change. Set this if you would rather pin it at build time.
   */
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || undefined,
} as const;
