import { Injectable, Logger, Optional } from '@nestjs/common';
import type Stripe from 'stripe';
import { BillingEventType, TimelineEventType, type Payment, type PaymentStatus } from '@bitcrm/types';
import { PaymentsRepository } from '../payments.repository';
import { PaymentsService } from '../payments.service';
import { canTransition, fromCents, round2, statusAfterRefund } from '../payment-rules';
import { StripeService, intentId } from './stripe.service';
import { PaymentReportProjector } from '../report/payment-report.projector';

/** Exactly the events the endpoint is subscribed to in the Stripe dashboard. */
export const SUBSCRIBED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const;

/**
 * An ACH debit that comes back AFTER Stripe reported the PaymentIntent as
 * `succeeded` arrives as a dispute, not a failure. These are the reasons that
 * mean "the bank took the money back", not "the customer is complaining".
 */
const ACH_RETURN_REASONS = new Set([
  'insufficient_funds',
  'incorrect_account_details',
  'bank_cannot_process',
  'debit_not_authorized',
  'customer_initiated',
  'check_returned',
]);

const humanise = (reason: string): string => reason.replace(/_/g, ' ');

/**
 * The webhook's brain. Two rules, and everything follows:
 *
 *  1. **Dedupe on `event.id`.** A `WEBHOOK#` row is claimed before any work;
 *     a replay finds it taken and does nothing. The claim is RELEASED when
 *     processing throws, so Stripe's retry (or the reconciliation sweep) can
 *     still land it.
 *  2. **Assert, never apply a delta.** Stripe promises no ordering. Every
 *     handler says "this payment is now X" and `canTransition` decides whether
 *     that is allowed — which is how a late `payment_intent.succeeded` fails
 *     to resurrect a payment the bank already pulled back.
 */
@Injectable()
export class StripeEventsHandler {
  private readonly logger = new Logger(StripeEventsHandler.name);
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly payments: PaymentsService,
    private readonly stripe: StripeService,
    @Optional() private readonly report?: PaymentReportProjector,
  ) {}

  /**
   * Claims the event and starts processing it. Returns `false` for a
   * duplicate. The claim is awaited (it is one conditional write) so
   * duplicates are answered truthfully; the work itself runs after the 200.
   */
  async receive(event: Stripe.Event): Promise<boolean> {
    const fresh = await this.repo.claimWebhookEvent(event.id, event.type);
    if (!fresh) {
      this.logger.debug(`stripe event ${event.id} (${event.type}) already handled`);
      return false;
    }
    const task = this.process(event)
      .catch(async (err: Error) => {
        this.logger.error(`stripe event ${event.id} (${event.type}) failed: ${err.message}`);
        // Let Stripe's retry, or the sweep, have another go.
        await this.repo.releaseWebhookEvent(event.id).catch(() => undefined);
      })
      .finally(() => this.inFlight.delete(task));
    this.inFlight.add(task);
    return true;
  }

  /** Awaits everything still being processed (tests, graceful shutdown). */
  async settle(): Promise<void> {
    while (this.inFlight.size) await Promise.all([...this.inFlight]);
  }

  async process(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
        return this.onSession(event.data.object as Stripe.Checkout.Session, event.type);
      case 'payment_intent.succeeded':
      case 'payment_intent.processing':
      case 'payment_intent.payment_failed':
        return this.onIntent(event.data.object as Stripe.PaymentIntent, event.type);
      case 'charge.refunded':
        return this.onChargeRefunded(event.data.object as Stripe.Charge);
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        return this.onRefund(event.data.object as Stripe.Refund);
      case 'charge.dispute.created':
      case 'charge.dispute.closed':
        return this.onDispute(event.data.object as Stripe.Dispute, event.type);
      default:
        this.logger.debug(`stripe event ${event.type} is not subscribed to — ignored`);
    }
  }

  // ----------------------------------------------------------- reconciliation

  /**
   * Re-asks Stripe what a still-pending payment actually did, and re-asserts
   * it. Webhooks give latency; this gives correctness — a delivery that was
   * dropped, a 500 we returned, or a session the customer simply abandoned all
   * end up right here instead of leaving a payment "clearing" forever.
   */
  async reconcile(payment: Payment): Promise<void> {
    if (!this.stripe.available) return;
    if (payment.stripePaymentIntentId) {
      const intent = await this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId);
      const type = INTENT_EVENT[intent.status];
      if (!type) return;
      return this.onIntent(intent, type);
    }
    if (!payment.stripeSessionId) return;
    const session = await this.stripe.retrieveSession(payment.stripeSessionId);
    if (session.status === 'expired') {
      return this.assert(payment, 'failed', { failureReason: 'The payment was not completed in time' });
    }
    if (session.status === 'complete') return this.onSession(session, 'checkout.session.completed');
    // Still open: the customer may yet finish it.
  }

  // ------------------------------------------------------------------ sessions

  private async onSession(session: Stripe.Checkout.Session, type: string): Promise<void> {
    const payment = await this.resolve(session.metadata, [session.id, intentId(session.payment_intent)]);
    if (!payment) return this.orphan(type, session.id);

    const intent = intentId(session.payment_intent);
    const patch: Partial<Payment> = {};
    // Recording the intent is what marks the attempt CONFIRMED: from here on
    // a new portal attempt supersedes nothing, it only tops up.
    if (intent && payment.stripePaymentIntentId !== intent) {
      patch.stripePaymentIntentId = intent;
      await this.repo.putStripePointer(intent, payment.id);
    }

    if (type === 'checkout.session.async_payment_failed') {
      return this.assert(payment, 'failed', { ...patch, failureReason: 'The bank payment was returned unpaid' });
    }
    // `unpaid` on a completed session is the ACH case: authorised, not landed.
    const target: PaymentStatus = session.payment_status === 'unpaid' ? 'pending' : 'settled';
    return this.assert(payment, target, patch);
  }

  // ------------------------------------------------------------------- intents

  private async onIntent(intent: Stripe.PaymentIntent, type: string): Promise<void> {
    const payment = await this.resolve(intent.metadata, [intent.id]);
    if (!payment) return this.orphan(type, intent.id);

    const patch: Partial<Payment> = {};
    if (payment.stripePaymentIntentId !== intent.id) {
      patch.stripePaymentIntentId = intent.id;
      await this.repo.putStripePointer(intent.id, payment.id);
    }
    const charge = chargeId(intent.latest_charge);
    if (charge && payment.stripeChargeId !== charge) {
      patch.stripeChargeId = charge;
      await this.repo.putStripePointer(charge, payment.id);
    }

    switch (type) {
      case 'payment_intent.processing':
        return this.assert(payment, 'pending', patch);
      case 'payment_intent.payment_failed':
        return this.assert(payment, 'failed', {
          ...patch,
          failureReason: intent.last_payment_error?.message || 'The payment did not go through',
        });
      default:
        return this.assert(payment, 'settled', patch);
    }
  }

  // ------------------------------------------------------------------ refunds

  /**
   * Stripe reports the refunded TOTAL on the charge, so this asserts that
   * total rather than adding to it — a replayed event is then a no-op.
   */
  private async onChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const payment = await this.resolve(charge.metadata, [charge.id, intentId(charge.payment_intent)]);
    if (!payment) return this.orphan('charge.refunded', charge.id);

    const refundedAmount = round2(Math.min(payment.amount, fromCents(charge.amount_refunded ?? 0)));
    const status = statusAfterRefund(payment, refundedAmount);
    if (refundedAmount === (payment.refundedAmount ?? 0) && status === payment.status) return;
    if (!canTransition(payment.status, status)) {
      return this.refused(payment, status, 'charge.refunded');
    }
    const updated = await this.repo.update(
      payment,
      { refundedAmount, status, updatedAt: new Date().toISOString() },
      [],
      { expectedVersion: payment.version },
    );
    await this.payments.syncLedger(updated, {
      event: BillingEventType.PAYMENT_REFUNDED,
      timeline: TimelineEventType.PAYMENT_REFUNDED,
      actorId: 'system',
      actorName: 'Stripe',
      metadata: { refundedAmount, source: 'stripe' },
    });
  }

  /** Keeps our refund row's status in step with Stripe's. */
  private async onRefund(refund: Stripe.Refund): Promise<void> {
    const paymentId = await this.paymentIdFor(refund.metadata, [
      intentId(refund.payment_intent),
      chargeId(refund.charge),
    ]);
    if (!paymentId) return this.orphan('refund.*', refund.id);
    const rows = await this.repo.listRefunds(paymentId);
    const row = rows.find((r) => r.stripeRefundId === refund.id);
    if (!row) return;
    const status = refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : refund.status === 'canceled' ? 'canceled' : 'pending';
    if (row.status === status) return;
    await this.repo.updateRefund(row, {
      status,
      ...(refund.failure_reason && { failureReason: refund.failure_reason }),
      updatedAt: new Date().toISOString(),
    });
    // A refund that failed or was cancelled leaves the Payments report.
    await this.report?.project(paymentId);
  }

  // ----------------------------------------------------------------- disputes

  /**
   * An ACH return lands here, not on the PaymentIntent — which stays
   * `succeeded` forever. So a dispute is the ONLY signal that settled money
   * left again, and it is treated as authoritative.
   */
  private async onDispute(dispute: Stripe.Dispute, type: string): Promise<void> {
    const payment = await this.resolve(dispute.metadata, [chargeId(dispute.charge), intentId(dispute.payment_intent)]);
    if (!payment) return this.orphan(type, dispute.id);

    const reason = humanise(dispute.reason ?? 'disputed');
    const bankReturn = ACH_RETURN_REASONS.has(dispute.reason ?? '');

    if (type === 'charge.dispute.closed' && dispute.status === 'won') {
      // We got the money back. Only a payment WE reversed for this reason is restored.
      if (payment.status !== 'reversed' || !payment.reversedAt) return;
      const updated = await this.repo.update(
        payment,
        { status: 'settled', settledAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ['reversedAt', 'failureReason'],
      );
      this.logger.warn(`payment ${payment.id}: dispute ${dispute.id} won — the payment counts again`);
      await this.payments.syncLedger(updated, {
        event: BillingEventType.PAYMENT_SUCCEEDED,
        timeline: TimelineEventType.PAYMENT_RECEIVED,
        actorId: 'system',
        actorName: 'Stripe',
        metadata: { disputeId: dispute.id, disputeStatus: 'won' },
      });
      return;
    }
    if (type === 'charge.dispute.closed' && dispute.status !== 'lost') {
      // warning_closed / under_review and friends: nothing has moved.
      return;
    }

    this.logger.warn(
      `payment ${payment.id} on invoice ${payment.invoiceId}: ${bankReturn ? 'BANK RETURN' : 'dispute'} (${reason}) ` +
        `— $${payment.amount.toFixed(2)} no longer counts toward the invoice`,
    );
    await this.assert(
      payment,
      'reversed',
      {
        reversedAt: new Date().toISOString(),
        failureReason: bankReturn
          ? `The bank returned this payment (${reason})`
          : `This payment was disputed (${reason})`,
      },
      { event: BillingEventType.PAYMENT_REVERSED, timeline: TimelineEventType.PAYMENT_REVERSED },
    );
  }

  // ---------------------------------------------------------------- internals

  /**
   * Asserts a status. The transition table, not the event, decides whether it
   * takes effect — and an assertion that changes nothing writes nothing.
   */
  private async assert(
    payment: Payment,
    target: PaymentStatus,
    patch: Partial<Payment> = {},
    published?: { event: BillingEventType; timeline: TimelineEventType },
  ): Promise<void> {
    if (!canTransition(payment.status, target)) return this.refused(payment, target, 'assert');

    const now = new Date().toISOString();
    const set: Partial<Payment> & Record<string, unknown> = { ...patch, updatedAt: now };
    const remove: string[] = [];
    const statusChanged = payment.status !== target;
    if (statusChanged) set.status = target;
    if (target === 'settled') {
      if (!payment.settledAt) set.settledAt = now;
      if (payment.failureReason) remove.push('failureReason');
    }
    // Nothing but `updatedAt` to say: leave the row alone.
    if (!statusChanged && Object.keys(patch).length === 0 && remove.length === 0) return;

    const updated = await this.repo.update(payment, set, remove, { expectedVersion: payment.version });

    // The portal writes its row `pending` before the customer has confirmed
    // anything, so "still pending" is not always a non-event: the moment an
    // intent is recorded, a bank payment has genuinely started moving and
    // staff should see it.
    const nowConfirmed = target === 'pending' && !payment.stripePaymentIntentId && !!patch.stripePaymentIntentId;
    if (!statusChanged && !nowConfirmed) return;

    const chosen = published ?? OUTCOME[target];
    if (!chosen) return;
    await this.payments.syncLedger(updated, {
      event: chosen.event,
      timeline: chosen.timeline,
      actorId: 'system',
      actorName: 'Stripe',
    });
  }

  private refused(payment: Payment, target: PaymentStatus, where: string): void {
    this.logger.warn(
      `${where}: refusing to move payment ${payment.id} from ${payment.status} to ${target} ` +
        '(Stripe events have no ordering guarantee)',
    );
  }

  private orphan(type: string, objectId: string): void {
    this.logger.warn(`stripe ${type} for ${objectId} matched no payment — ignored`);
  }

  /** metadata.paymentId first (we set it on the session AND the intent), pointers second. */
  private async resolve(
    metadata: Stripe.Metadata | null | undefined,
    objectIds: Array<string | undefined>,
  ): Promise<Payment | null> {
    const id = await this.paymentIdFor(metadata, objectIds);
    return id ? this.repo.get(id) : null;
  }

  private async paymentIdFor(
    metadata: Stripe.Metadata | null | undefined,
    objectIds: Array<string | undefined>,
  ): Promise<string | null> {
    const fromMetadata = metadata?.paymentId;
    if (fromMetadata) return fromMetadata;
    for (const objectId of objectIds) {
      if (!objectId) continue;
      const found = await this.repo.findPaymentIdByStripeObject(objectId);
      if (found) return found;
    }
    return null;
  }
}

/** What each terminal status publishes, when the caller has no opinion. */
const OUTCOME: Partial<Record<PaymentStatus, { event: BillingEventType; timeline: TimelineEventType }>> = {
  settled: { event: BillingEventType.PAYMENT_SUCCEEDED, timeline: TimelineEventType.PAYMENT_RECEIVED },
  pending: { event: BillingEventType.PAYMENT_PENDING, timeline: TimelineEventType.PAYMENT_PENDING },
  failed: { event: BillingEventType.PAYMENT_FAILED, timeline: TimelineEventType.PAYMENT_FAILED },
  reversed: { event: BillingEventType.PAYMENT_REVERSED, timeline: TimelineEventType.PAYMENT_REVERSED },
  refunded: { event: BillingEventType.PAYMENT_REFUNDED, timeline: TimelineEventType.PAYMENT_REFUNDED },
};

/**
 * A PaymentIntent's own status, mapped back onto the event that would have
 * carried it. Statuses that mean "still in the customer's hands"
 * (`requires_action`, `requires_confirmation`, `requires_capture`) are absent
 * on purpose: nothing has happened yet.
 */
const INTENT_EVENT: Record<string, string | undefined> = {
  succeeded: 'payment_intent.succeeded',
  processing: 'payment_intent.processing',
  canceled: 'payment_intent.payment_failed',
  requires_payment_method: 'payment_intent.payment_failed',
};

/** Stripe hands back either an id or an expanded object. */
function chargeId(v: string | Stripe.Charge | null | undefined): string | undefined {
  if (!v) return undefined;
  return typeof v === 'string' ? v : v.id;
}
