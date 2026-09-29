import { Global, Module, type DynamicModule } from '@nestjs/common';
import Stripe from 'stripe';

/** DI token for the Stripe SDK. `null` when no secret key is configured. */
export const STRIPE_CLIENT = 'STRIPE_CLIENT';
export type StripeClient = Stripe | null;

/**
 * `satisfies` on purpose: stripe@22's types only describe ONE API version, so
 * pinning an older string is a compile error by design. When the SDK is
 * upgraded this line fails to build until the literal is updated with it.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia' satisfies Stripe.LatestApiVersion;

export function createStripeClient(secretKey = process.env.STRIPE_SECRET_KEY): StripeClient {
  if (!secretKey) return null;
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    typescript: true,
    appInfo: { name: 'BitCRM billing-service' },
  });
}

/**
 * The whole Stripe wiring. `@golevelup/nestjs-stripe` is deliberately not used
 * (peer-locked to stripe v20). With no `STRIPE_SECRET_KEY` the token resolves
 * to `null` and the service still boots — the offline ledger does not need
 * Stripe, and every online path checks `StripeService.available` first.
 */
@Global()
@Module({})
export class StripeModule {
  static forRootAsync(): DynamicModule {
    return {
      module: StripeModule,
      providers: [{ provide: STRIPE_CLIENT, useFactory: () => createStripeClient() }],
      exports: [STRIPE_CLIENT],
    };
  }
}
