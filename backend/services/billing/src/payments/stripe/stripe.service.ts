import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';
import { STRIPE_CLIENT, type StripeClient } from './stripe.module';
import { toCents } from '../payment-rules';

export interface CheckoutSessionInput {
  paymentId: string;
  invoiceId: string;
  dealId: string;
  contactId: string;
  /** Dollars. The surcharge, when any, is a second line item. */
  amount: number;
  surcharge: number;
  surchargeLabel: string;
  currency: string;
  /** What the client sees on the Stripe line: "Invoice 4K9ZTW". */
  description: string;
  method: 'card' | 'bank';
  returnUrl: string;
  customerEmail?: string;
  /** One key per attempt — a retried POST must not create a second session. */
  idempotencyKey: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  clientSecret: string;
  paymentIntentId?: string;
}

/** Raised when a webhook body is not signed by Stripe (or is too old). */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * Everything that talks to Stripe. Every method first asks `available` — with
 * no `STRIPE_SECRET_KEY` the service still boots and the offline ledger works,
 * online payments simply report unavailable.
 *
 * Money crosses the boundary here and nowhere else: our types carry dollars,
 * Stripe carries cents (`toCents`).
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  constructor(@Optional() @Inject(STRIPE_CLIENT) private readonly stripe: StripeClient = null) {}

  get available(): boolean {
    return !!this.stripe;
  }

  get publishableKey(): string {
    return process.env.STRIPE_PUBLISHABLE_KEY || '';
  }

  /**
   * Whether a CLIENT can actually be shown a payment form. The portal needs
   * both halves — the secret key to open a session and the publishable key to
   * mount the Payment Element — so a half-configured account must offer no
   * methods at all rather than a form that cannot load.
   */
  get onlineReady(): boolean {
    return this.available && !!this.publishableKey;
  }

  private get webhookSecret(): string {
    return process.env.STRIPE_WEBHOOK_SECRET || '';
  }

  /** What Settings → Payments shows: which halves of the integration are wired. */
  get configured(): { secretKey: boolean; webhookSecret: boolean; publishableKey: boolean } {
    return {
      secretKey: !!this.stripe,
      webhookSecret: !!this.webhookSecret,
      publishableKey: !!this.publishableKey,
    };
  }

  private client(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Online payments are not configured for this account');
    }
    return this.stripe;
  }

  /**
   * Verifies the signature AND the timestamp (Stripe's default 5-minute
   * tolerance) and parses the event. Synchronous by design — `constructEvent`,
   * not `constructEventAsync`.
   */
  constructEvent(payload: Buffer | string | undefined, signature: string | undefined): Stripe.Event {
    if (!this.stripe) throw new WebhookSignatureError('Stripe is not configured');
    if (!this.webhookSecret) throw new WebhookSignatureError('No webhook signing secret configured');
    if (!payload || !payload.length) throw new WebhookSignatureError('Empty request body');
    if (!signature) throw new WebhookSignatureError('Missing stripe-signature header');
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
    } catch (err) {
      throw new WebhookSignatureError((err as Error).message);
    }
  }

  /**
   * A Checkout Session in `elements` mode: our own portal page renders the
   * Payment Element against its client secret. `payment_method_types` is no
   * longer writable in this API version, so the method choice is expressed by
   * EXCLUDING the other one.
   *
   * Metadata is set on the session AND on `payment_intent_data` — it does not
   * propagate from one to the other, and most webhooks carry only the intent.
   */
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const metadata = {
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      dealId: input.dealId,
      contactId: input.contactId,
    };
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: input.currency,
          unit_amount: toCents(input.amount),
          product_data: { name: input.description },
        },
      },
    ];
    if (input.surcharge > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: input.currency,
          unit_amount: toCents(input.surcharge),
          product_data: { name: input.surchargeLabel },
        },
      });
    }

    const session = await this.client().checkout.sessions.create(
      {
        ui_mode: 'elements',
        mode: 'payment',
        line_items: lineItems,
        client_reference_id: input.invoiceId,
        metadata,
        payment_intent_data: { metadata, description: input.description },
        return_url: input.returnUrl,
        // The method the client picked; the other rail is excluded because
        // `payment_method_types` is read-only in this API version.
        excluded_payment_method_types: input.method === 'bank' ? ['card'] : ['us_bank_account'],
        ...(input.customerEmail && { customer_email: input.customerEmail }),
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (!session.client_secret) {
      throw new ServiceUnavailableException('Stripe did not return a client secret for this payment');
    }
    return {
      sessionId: session.id,
      clientSecret: session.client_secret,
      ...(intentId(session.payment_intent) && { paymentIntentId: intentId(session.payment_intent)! }),
    };
  }

  retrieveSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.client().checkout.sessions.retrieve(sessionId);
  }

  retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return this.client().paymentIntents.retrieve(paymentIntentId);
  }

  /** Dollars in, dollars out — cents exist only inside this method. */
  async createRefund(input: {
    paymentIntentId: string;
    amount: number;
    reason?: string;
    idempotencyKey: string;
  }): Promise<Stripe.Refund> {
    return this.client().refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: toCents(input.amount),
        ...(isStripeReason(input.reason) && { reason: input.reason }),
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  /** Best effort: a failed expiry must never fail the write that asked for it. */
  async expireSession(sessionId: string): Promise<void> {
    try {
      await this.client().checkout.sessions.expire(sessionId);
    } catch (err) {
      this.logger.warn(`expiring checkout session ${sessionId} failed: ${(err as Error).message}`);
    }
  }
}

/** Stripe hands back either an id or an expanded object. */
export function intentId(v: string | Stripe.PaymentIntent | null | undefined): string | undefined {
  if (!v) return undefined;
  return typeof v === 'string' ? v : v.id;
}

const STRIPE_REFUND_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'] as const;
type StripeRefundReason = (typeof STRIPE_REFUND_REASONS)[number];
/** Our `reason` is free text for the client; only Stripe's three enum values go up. */
function isStripeReason(v: string | undefined): v is StripeRefundReason {
  return !!v && (STRIPE_REFUND_REASONS as readonly string[]).includes(v);
}
