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

/** A Stripe address as Terminal Locations take it (US: every field but `line2` is required). */
export interface TerminalAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  /** ISO 3166-1 alpha-2. Immutable once the Location exists. */
  country: string;
}

export interface TerminalIntentInput {
  /** Dollars toward the balance / deposit. */
  amount: number;
  /** Dollars on top, chosen on the phone BEFORE the tap (Tap to Pay has no on-reader tipping). */
  tipAmount: number;
  /** The service fee on top (`surchargePercent` of amount + tip), dollars. 0 / absent when the account charges none. */
  feeAmount?: number;
  currency: string;
  /** "Invoice K4T9ZW" / "Deposit for estimate K4T9ZW-1" — on the Stripe payment and the bank statement line. */
  description: string;
  /** `paymentId` is the webhook's join; Stripe copies intent metadata onto the charge. */
  metadata: Record<string, string>;
  /** One per payment attempt: a retried POST gets the same intent back. */
  idempotencyKey: string;
}

/** A card the technician TYPED on the phone (card-not-present): created and confirmed in one call. */
export interface KeyedIntentInput {
  /** Dollars toward the balance / deposit. */
  amount: number;
  /** Dollars on top, chosen before the card is charged. */
  tipAmount: number;
  /** The service fee on top (`surchargePercent` of amount + tip), dollars; 0 when the account charges none. */
  feeAmount: number;
  currency: string;
  /** `pm_…` the phone made from the typed card with @stripe/stripe-react-native — no card number reaches us. */
  paymentMethodId: string;
  description: string;
  /** `paymentId` is the webhook's join; Stripe copies intent metadata onto the charge. */
  metadata: Record<string, string>;
  /** One per payment attempt: a retried POST gets the same intent — and the same outcome — back. */
  idempotencyKey: string;
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

  /** `expandCharge` inlines `latest_charge` — the card that paid (brand, last 4). */
  retrievePaymentIntent(paymentIntentId: string, opts: { expandCharge?: boolean } = {}): Promise<Stripe.PaymentIntent> {
    return opts.expandCharge
      ? this.client().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
      : this.client().paymentIntents.retrieve(paymentIntentId);
  }

  // ------------------------------------------------------------ Terminal

  /**
   * A Stripe Terminal connection token for the technician's phone (the SDK's
   * token provider). Short-lived and single-use: never cached on either side.
   * `location` only scopes internet readers — it has no effect on Tap to Pay.
   */
  async createConnectionToken(locationId?: string): Promise<{ secret: string }> {
    const token = await this.client().terminal.connectionTokens.create(locationId ? { location: locationId } : {});
    return { secret: token.secret };
  }

  /** The Location a Tap to Pay reader is connected under (`connectReader({ locationId })`). */
  async createTerminalLocation(input: {
    displayName: string;
    address: TerminalAddress;
    idempotencyKey: string;
  }): Promise<Stripe.Terminal.Location> {
    return this.client().terminal.locations.create(
      { display_name: input.displayName, address: input.address },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  /**
   * A card-present PaymentIntent the phone collects and CONFIRMS on the device
   * (server-side confirmation would skip the PIN prompt). Captured
   * automatically: Tap to Pay has no after-auth tipping, so the tip is chosen
   * first and charged in the same amount, with the service fee when the
   * account has one — `amount + tipAmount + feeAmount`, in cents.
   */
  async createTerminalIntent(input: TerminalIntentInput): Promise<Stripe.PaymentIntent> {
    const intent = await this.client().paymentIntents.create(
      {
        amount: toCents(input.amount) + toCents(input.tipAmount) + toCents(input.feeAmount ?? 0),
        currency: input.currency,
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        description: input.description,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!intent.client_secret) {
      throw new ServiceUnavailableException('Stripe did not return a client secret for this payment');
    }
    return intent;
  }

  /**
   * "Type card manually": a `card` PaymentIntent for `amount + tip + fee` (in
   * cents), CONFIRMED in the same call with the PaymentMethod the phone
   * created — the client is present, the technician typed their card.
   * Captured automatically. `use_stripe_sdk` lets the phone finish a 3-D
   * Secure step (`requires_action`) with `handleNextAction(clientSecret)`;
   * the charge comes back expanded so the card's brand and last 4 land with
   * the settlement. A decline is Stripe's error (`StripeCardError`, carrying
   * the intent) and is left to the caller, untouched: it decides what a
   * refused card means for the attempt.
   */
  async createKeyedIntent(input: KeyedIntentInput): Promise<Stripe.PaymentIntent> {
    return this.client().paymentIntents.create(
      {
        amount: toCents(input.amount) + toCents(input.tipAmount) + toCents(input.feeAmount),
        currency: input.currency,
        payment_method: input.paymentMethodId,
        payment_method_types: ['card'],
        confirm: true,
        capture_method: 'automatic',
        use_stripe_sdk: true,
        description: input.description,
        metadata: input.metadata,
        expand: ['latest_charge'],
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async cancelPaymentIntent(
    paymentIntentId: string,
    reason: 'abandoned' | 'duplicate' | 'requested_by_customer',
  ): Promise<Stripe.PaymentIntent> {
    return this.client().paymentIntents.cancel(paymentIntentId, { cancellation_reason: reason });
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
