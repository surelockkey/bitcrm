import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Stripe from 'stripe';
import {
  estimateDepositDue,
  type Address,
  type KeyedPaymentIntent,
  type Payment,
  type PaymentChannel,
  type SignatureDocumentKind,
  type TerminalConnectionToken,
  type TerminalIntentOutcome,
  type TerminalLocation,
  type TerminalPaymentIntent,
} from '@bitcrm/types';
import { BusinessProfileService } from '../../business-profile/business-profile.service';
import { assertDealAccess, isAssignedOnly, type Caller } from '../../common/access';
import { EstimatesService } from '../../estimates/estimates.service';
import { DealClient } from '../../integrations/deal.client';
import { SignaturesService } from '../../signatures/signatures.service';
import { PaymentSettingsService } from '../payment-settings.service';
import { round2, serviceFeeFor, summarizePayments, toCents } from '../payment-rules';
import { PaymentVersionConflictError, PaymentsRepository } from '../payments.repository';
import { PaymentsService, clampStaffAmount, jobDims, type PaymentOwner } from '../payments.service';
import { StripeEventsHandler } from '../stripe/stripe-events.handler';
import { StripeService, type TerminalAddress } from '../stripe/stripe.service';

/** What the phone sends to start (or retry) one card payment. */
export interface TerminalIntentRequest {
  /** Dollars toward the balance — or, on an estimate, toward its deposit. */
  amount: number;
  /** Dollars on top, chosen on the phone BEFORE the tap. Never toward the balance. */
  tipAmount?: number;
  /**
   * A UUID the phone makes once per payment attempt. It becomes the ledger
   * row's id and the Stripe idempotency key, so a retried POST gets the same
   * row and the same PaymentIntent back.
   */
  attemptId: string;
}

/** "Type card manually": the same, plus the card the technician typed — as a Stripe PaymentMethod. */
export interface CardIntentRequest extends TerminalIntentRequest {
  /**
   * `pm_…` the phone made with @stripe/stripe-react-native `createPaymentMethod`
   * from the typed card. The card number itself never reaches billing.
   */
  paymentMethodId: string;
}

/** The exact copy the phone keys its "back to the signature" step on. */
export const SIGNATURE_REQUIRED = 'A signature is required before payment';

/** `Payment.transactionMethod` of each phone channel (the Payments report's column). */
const TRANSACTION_METHOD: Record<PaymentChannel, string> = { terminal: 'Tap to Pay', keyed: 'Keyed' };

/** What a typed-card attempt fails with when Stripe never answered (the same attempt id asks again). */
const NO_ANSWER = 'Stripe did not answer — the card may not have been charged; try again';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A Stripe PaymentMethod id (`pm_…`; test mode also has `pm_card_visa` and friends). */
const PAYMENT_METHOD_ID = /^pm_[A-Za-z0-9_]{1,250}$/;

interface Attempt {
  attemptId: string;
  amount: number;
  tipAmount: number;
}

interface OpenParams {
  caller: Caller;
  input: Attempt;
  owner: PaymentOwner & { estimateId?: string };
  /** The document the client signed — and that the money is for. */
  document: { kind: SignatureDocumentKind; id: string; signedAt?: string };
  description: string;
  /** What is still owed — of the balance, or of the deposit — given the job's ledger. */
  owed: (ledger: Payment[]) => number;
  /** The rows whose money may still land against it (a deposit: its own). */
  scope: (ledger: Payment[]) => Payment[];
}

/**
 * A card on a staff phone, the Workiz way: the client signs first, then the
 * card is tapped (Stripe Terminal, Tap to Pay — channel `terminal`) or typed
 * in by the technician (channel `keyed`) — never the other way round. Both
 * channels share every attempt rule below; they differ only in the Stripe call
 * and in what the phone is answered.
 *
 * One Tap to Pay attempt, end to end:
 *  1. `open*` writes the ledger row FIRST (`pending`, `channel: terminal`, the
 *     tip on it), then creates a `card_present` PaymentIntent for
 *     `amount + tip` with `metadata.paymentId`, and records the intent on the
 *     row and as a `STRIPE#` pointer — so every webhook finds its payment.
 *  2. The phone collects and confirms on the device (capture is automatic).
 *  3. `sync` asks Stripe right away and asserts the outcome through the
 *     webhook's own path; the webhook and the reconciliation sweep land the
 *     same answer later, as no-ops.
 *
 * A typed card ("Type card manually") writes the same row first, then
 * creates AND confirms a `card` PaymentIntent with the PaymentMethod the
 * phone made, and asserts Stripe's answer at once: `succeeded` settles the
 * row, a decline fails it (the phone asks for another card under a new
 * attempt id), `requires_action` leaves it pending for the phone's 3-D Secure
 * step and `sync`.
 *
 * A retried POST (same `attemptId`) answers the same row and intent. A new
 * attempt by the same person on the same job replaces their unconfirmed one
 * — tapped or typed — (cancelled at Stripe first, so it can never be
 * charged); money that may still land caps what a new attempt may take.
 */
@Injectable()
export class TerminalService {
  private readonly logger = new Logger(TerminalService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly payments: PaymentsService,
    private readonly settings: PaymentSettingsService,
    private readonly deal: DealClient,
    private readonly stripe: StripeService,
    private readonly handler: StripeEventsHandler,
    @Optional() private readonly estimates?: EstimatesService,
    @Optional() private readonly profiles?: BusinessProfileService,
    @Optional() private readonly signatures?: SignaturesService,
  ) {}

  // ------------------------------------------------------- reader set-up

  /** For the Terminal SDK's token provider. Minted per call; nothing is stored. */
  async connectionToken(): Promise<TerminalConnectionToken> {
    this.requireStripe();
    const { terminalLocationId } = await this.settings.get();
    return this.stripe.createConnectionToken(terminalLocationId);
  }

  async location(): Promise<TerminalLocation> {
    const { terminalLocationId } = await this.settings.get();
    return { locationId: terminalLocationId ?? null };
  }

  /**
   * The account's one Terminal Location, created on first use from the
   * DEFAULT company's address and remembered in payment settings. Asking
   * again answers the same one. A US Location needs street, city, state and
   * ZIP — a 400 names whichever are missing.
   */
  async ensureLocation(caller: Caller): Promise<TerminalLocation> {
    this.requireStripe();
    const current = await this.settings.get();
    if (current.terminalLocationId) return { locationId: current.terminalLocationId };

    const company = await this.requireProfiles().getDefault();
    const address = terminalAddress(company.address);
    const displayName = (company.name ?? '').trim().slice(0, 1000) || 'Main location';
    const created = await this.stripe.createTerminalLocation({
      displayName,
      address,
      // Two phones setting up at once get the same Location, not two.
      idempotencyKey: `terminal_location_${digest({ company: company.id, displayName, address })}`,
    });
    await this.settings.setTerminalLocation(created.id, caller.user.id);
    return {
      locationId: created.id,
      displayName,
      address: {
        line1: address.line1,
        ...(address.line2 && { line2: address.line2 }),
        city: address.city,
        state: address.state,
        postalCode: address.postal_code,
        country: address.country,
      },
    };
  }

  // ---------------------------------------------------------- the intents

  /** A card tapped on the job's invoice: up to its balance, plus any tip (and the service fee). */
  async openForInvoice(invoiceId: string, request: TerminalIntentRequest, caller: Caller): Promise<TerminalPaymentIntent> {
    const input = parseRequest(request);
    this.requireStripe();
    return this.openTerminal(await this.invoiceAttempt(invoiceId, input, caller));
  }

  /**
   * An estimate's deposit by card. It lands on the JOB's ledger tagged with
   * the estimate (as the portal's deposit does), so it is applied to the job's
   * balance later; the ceiling is what is still owed of the deposit. No
   * "approved" barrier here — the signature on file is the gate.
   */
  async openForEstimate(estimateId: string, request: TerminalIntentRequest, caller: Caller): Promise<TerminalPaymentIntent> {
    const input = parseRequest(request);
    this.requireStripe();
    return this.openTerminal(await this.estimateAttempt(estimateId, input, caller));
  }

  /** "Type card manually" on the job's invoice — the same rules as a tap. */
  async openCardForInvoice(invoiceId: string, request: CardIntentRequest, caller: Caller): Promise<KeyedPaymentIntent> {
    const input = parseRequest(request);
    const paymentMethodId = parsePaymentMethod(request);
    this.requireStripe();
    return this.openKeyed(await this.invoiceAttempt(invoiceId, input, caller), paymentMethodId);
  }

  /** "Type card manually" for an estimate's deposit — the same rules as a tapped deposit. */
  async openCardForEstimate(estimateId: string, request: CardIntentRequest, caller: Caller): Promise<KeyedPaymentIntent> {
    const input = parseRequest(request);
    const paymentMethodId = parsePaymentMethod(request);
    this.requireStripe();
    return this.openKeyed(await this.estimateAttempt(estimateId, input, caller), paymentMethodId);
  }

  /** The job's invoice as an attempt's owner: 404 / 403 off the roster / 409 for a client invoice (no job). */
  private async invoiceAttempt(invoiceId: string, input: Attempt, caller: Caller): Promise<OpenParams> {
    const { invoice, deal } = await this.payments.jobInvoiceFor(invoiceId, caller);
    return {
      caller,
      input,
      owner: {
        invoiceId: invoice.id,
        dealId: invoice.dealId,
        contactId: invoice.contactId,
        ...(invoice.companyId && { companyId: invoice.companyId }),
        ...jobDims(deal),
      },
      document: { kind: 'invoice', id: invoice.id, signedAt: invoice.signedAt },
      description: `Invoice ${invoice.number}`,
      owed: (ledger) => round2(Math.max(0, (invoice.totals?.total ?? 0) - summarizePayments(ledger).settled)),
      scope: (ledger) => ledger,
    };
  }

  /**
   * An estimate's deposit as an attempt's owner: on the job's ledger, tagged
   * with the estimate. 404 / 409 for a client estimate (no job) / 403 off the
   * roster / 400 when it asks for no deposit.
   */
  private async estimateAttempt(estimateId: string, input: Attempt, caller: Caller): Promise<OpenParams> {
    const estimate = await this.requireEstimates().getStored(estimateId);
    if (!estimate) throw new NotFoundException('Estimate not found');
    if (!estimate.dealId) {
      if (isAssignedOnly(caller, 'payments')) {
        throw new ForbiddenException('This estimate belongs to the client and has no job you are assigned to');
      }
      throw new ConflictException('This estimate has no job to hold its deposit — copy it to a job first');
    }
    const view = await this.deal.getBillingView(estimate.dealId);
    if (!view) throw new NotFoundException('Job not found');
    assertDealAccess(caller, 'payments', view.deal);
    const depositDue = estimateDepositDue(estimate);
    if (!(depositDue > 0)) throw new BadRequestException('This estimate does not ask for a deposit');

    const dealId = view.deal.id;
    const deposit = (ledger: Payment[]) => ledger.filter((p) => p.estimateId === estimate.id);
    return {
      caller,
      input,
      owner: {
        invoiceId: dealId,
        dealId,
        contactId: estimate.contactId,
        ...(estimate.companyId && { companyId: estimate.companyId }),
        estimateId: estimate.id,
        ...jobDims(view.deal),
      },
      document: { kind: 'estimate', id: estimate.id, signedAt: estimate.signedAt },
      description: `Deposit for estimate ${estimate.number}`,
      owed: (ledger) => round2(Math.max(0, depositDue - summarizePayments(deposit(ledger)).settled)),
      scope: deposit,
    };
  }

  // --------------------------------------------------------- cancel / sync

  /**
   * The phone gave up on the attempt: the intent is cancelled at Stripe so it
   * can never be charged, and the row fails as "Cancelled on the device". An
   * attempt that already went through cannot be cancelled — 409, refund it.
   */
  async cancel(paymentId: string, caller: Caller): Promise<TerminalIntentOutcome> {
    const payment = await this.attemptFor(paymentId, caller);
    if (payment.status === 'pending' || payment.status === 'failed') {
      await this.withdraw(payment, 'requested_by_customer', 'Cancelled on the device');
    }
    const now = await this.payments.require(paymentId);
    if (now.status === 'settled' || now.status === 'refunded' || now.status === 'reversed') {
      throw new ConflictException('This payment already went through — refund it instead of cancelling it');
    }
    return this.outcome(now, caller);
  }

  /** Right after the tap (or a typed card's 3-D Secure step): what Stripe says now, asserted the webhook's way, with the job's ledger. */
  async sync(paymentId: string, caller: Caller): Promise<TerminalIntentOutcome> {
    const payment = await this.attemptFor(paymentId, caller);
    await this.handler.syncIntent(payment);
    return this.outcome(await this.payments.require(paymentId), caller);
  }

  // ------------------------------------------------------------- internals

  private async openTerminal(p: OpenParams): Promise<TerminalPaymentIntent> {
    const existing = await this.repo.get(p.input.attemptId);
    if (existing) return this.replayTerminal(existing, p);
    const { payment, fresh } = await this.writeAttempt(p, 'terminal');
    return fresh ? this.attachTerminal(payment, p) : this.replayTerminal(payment, p);
  }

  private async openKeyed(p: OpenParams, paymentMethodId: string): Promise<KeyedPaymentIntent> {
    const existing = await this.repo.get(p.input.attemptId);
    if (existing) return this.replayKeyed(existing, p, paymentMethodId);
    const { payment, fresh } = await this.writeAttempt(p, 'keyed');
    return fresh ? this.chargeKeyed(payment, p, paymentMethodId) : this.replayKeyed(payment, p, paymentMethodId);
  }

  /**
   * Signature first, then the ceiling, then the `pending` row — before Stripe
   * hears of it, so every webhook finds its payment. `fresh: false` is the
   * same attempt posted twice at once: the row the other request wrote.
   */
  private async writeAttempt(p: OpenParams, channel: PaymentChannel): Promise<{ payment: Payment; fresh: boolean }> {
    const { caller, input } = p;
    await this.assertSigned(p.document);

    const ledger = await this.supersedeOwnAttempts(p.owner.dealId, caller, input.attemptId);
    const owed = p.owed(ledger);
    const inFlight = pendingOf(p.scope(ledger));
    // Money that may still land (another phone's tap, an ACH payment) is not
    // deducted from what is owed — but it caps what this attempt may take.
    const ceiling = round2(owed - inFlight);
    if (owed > 0 && ceiling <= 0) {
      throw new ConflictException(
        `A payment of $${inFlight.toFixed(2)} is still going through — nothing more can be taken until it lands or fails`,
      );
    }
    const amount = clampStaffAmount(input.amount, owed > 0 ? ceiling : 0);
    // Workiz's "Service fee": the account's surcharge on what the card pays for, tip included.
    const { surchargePercent } = await this.settings.get();
    const feeAmount = serviceFeeFor(amount, input.tipAmount, surchargePercent);

    const now = new Date().toISOString();
    const payment: Payment = {
      id: input.attemptId,
      ...p.owner,
      amount,
      currency: 'usd',
      method: 'card',
      status: 'pending',
      refundedAmount: 0,
      ...(input.tipAmount > 0 && { tipAmount: input.tipAmount }),
      ...(feeAmount > 0 && { feeAmount }),
      source: isAssignedOnly(caller, 'payments') ? 'field' : 'office',
      channel,
      transactionMethod: TRANSACTION_METHOD[channel],
      takenBy: caller.user.id,
      takenAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.repo.create(payment);
      return { payment, fresh: true };
    } catch (err) {
      // The same attempt posted twice at once: answer what the other request wrote.
      const raced = await this.repo.get(payment.id);
      if (raced) return { payment: raced, fresh: false };
      throw err;
    }
  }

  /** The intent for a row that exists — created under the attempt's idempotency key. */
  private async attachTerminal(payment: Payment, p: OpenParams): Promise<TerminalPaymentIntent> {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.createTerminalIntent({
        amount: payment.amount,
        tipAmount: payment.tipAmount ?? 0,
        feeAmount: payment.feeAmount ?? 0,
        currency: payment.currency,
        description: p.description,
        metadata: intentMetadata(payment, p, 'terminal'),
        idempotencyKey: `terminal_${payment.id}`,
      });
    } catch (err) {
      // No intent means nothing to tap: drop the row rather than leave a
      // "clearing" line nobody can finish. A retry starts again cleanly.
      await this.repo.delete(payment).catch(() => undefined);
      throw err;
    }
    await this.repo.putStripePointer(intent.id, payment.id);
    const updated = await this.repo.update(payment, {
      stripePaymentIntentId: intent.id,
      updatedAt: new Date().toISOString(),
    });
    return answer(updated, intent);
  }

  /** A retried Tap to Pay POST: the same row and the same intent — or 409 when the attempt id means something else. */
  private async replayTerminal(existing: Payment, p: OpenParams): Promise<TerminalPaymentIntent> {
    this.assertSameAttempt(existing, p, 'terminal');
    // A failed attempt is not handed out again: a new one re-checks the
    // balance and the signature. (A decline is retried on the device with the
    // intent it already holds — that needs no POST.)
    if (existing.status === 'failed') throw attemptOver();
    // The row was written but the intent never was (a crash in between).
    if (!existing.stripePaymentIntentId) return this.attachTerminal(existing, p);

    const intent = await this.stripe.retrievePaymentIntent(existing.stripePaymentIntentId);
    let row = existing;
    if (row.status === 'pending' && ['succeeded', 'processing', 'canceled'].includes(intent.status)) {
      // It moved on at Stripe before its webhook got here: answer where it is now.
      await this.handler.syncIntent(row);
      row = (await this.repo.get(row.id)) ?? row;
    }
    if (row.status === 'failed') throw attemptOver();
    return answer(row, intent);
  }

  /**
   * The typed card, created AND confirmed under the attempt's idempotency
   * key; then Stripe's answer is asserted the webhook's way.
   */
  private async chargeKeyed(payment: Payment, p: OpenParams, paymentMethodId: string): Promise<KeyedPaymentIntent> {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.createKeyedIntent({
        amount: payment.amount,
        tipAmount: payment.tipAmount ?? 0,
        feeAmount: payment.feeAmount ?? 0,
        currency: payment.currency,
        paymentMethodId,
        description: p.description,
        metadata: intentMetadata(payment, p, 'keyed'),
        idempotencyKey: `keyed_${payment.id}`,
      });
    } catch (err) {
      return this.keyedRefusal(payment, err);
    }
    return this.settleKeyed(payment, intent);
  }

  /**
   * Records the intent on the row (and its `STRIPE#` pointer), asserts what
   * it says — `succeeded` settles the row now ("assert, never add": the
   * webhook that follows is a no-op), a decline fails it, `requires_action`
   * leaves it pending — and answers the phone.
   */
  private async settleKeyed(payment: Payment, intent: Stripe.PaymentIntent, declineMessage?: string): Promise<KeyedPaymentIntent> {
    if (payment.stripePaymentIntentId !== intent.id) {
      await this.repo.putStripePointer(intent.id, payment.id);
      await this.repo.update(payment, { stripePaymentIntentId: intent.id, updatedAt: new Date().toISOString() });
    }
    await this.handler.assertIntent(intent);
    return keyedAnswer((await this.repo.get(payment.id)) ?? payment, intent, declineMessage);
  }

  /**
   * What a create that threw means for the attempt:
   *  - Stripe made the intent and refused the card on it — a decline
   *    (`StripeCardError`) or a PaymentMethod it would not use: nothing was
   *    charged. The attempt fails with Stripe's words and the phone hears 200
   *    `requires_payment_method` + `declineMessage`; another card is a NEW
   *    attempt id.
   *  - Stripe refused the request before any intent existed (a bad
   *    PaymentMethod id, an amount it will not take): nothing exists to
   *    charge. The row goes, as with Tap to Pay; 400 with Stripe's words.
   *  - No answer (the network, Stripe 5xx): the card MAY have been charged.
   *    The row stays — failed, so it caps nothing — and the phone retries
   *    the SAME attempt id: the same idempotency key asks Stripe again and
   *    gets the first answer. A late `payment_intent.succeeded` settles it on
   *    its own (failed → settled is allowed).
   */
  private async keyedRefusal(payment: Payment, err: unknown): Promise<KeyedPaymentIntent> {
    const refusal = stripeError(err);
    const message = refusal?.message || 'The card was declined';
    if (refusal?.payment_intent?.id) {
      const intent = {
        ...refusal.payment_intent,
        last_payment_error: refusal.payment_intent.last_payment_error ?? { type: 'card_error', message },
        latest_charge: refusal.payment_intent.latest_charge ?? refusal.charge ?? null,
      } as Stripe.PaymentIntent;
      return this.settleKeyed(payment, intent, message);
    }
    if (refusal && (refusal.type === 'StripeCardError' || refusal.rawType === 'card_error')) {
      // A decline that names no intent (Stripe always sends one; belt and braces).
      await this.fail(payment, message);
      return keyedAnswer((await this.repo.get(payment.id)) ?? payment, undefined, message);
    }
    if (refusal?.statusCode && refusal.statusCode >= 400 && refusal.statusCode < 500) {
      await this.repo.delete(payment).catch(() => undefined);
      if ([400, 402, 404].includes(refusal.statusCode)) throw new BadRequestException(message);
      throw new ServiceUnavailableException(`Stripe would not take the card right now: ${message}`);
    }
    this.logger.warn(
      `payment ${payment.id}: no answer from Stripe for a typed card (${(err as Error)?.message}) — kept as failed for a retry`,
    );
    await this.fail(payment, NO_ANSWER);
    throw new ServiceUnavailableException('Stripe did not answer — try again with the same attempt');
  }

  /**
   * A retried typed-card POST: the same row and the same intent, with what
   * Stripe says now — a decline answers the same decline (200), never a
   * second charge. 409 when the attempt id means something else.
   */
  private async replayKeyed(existing: Payment, p: OpenParams, paymentMethodId: string): Promise<KeyedPaymentIntent> {
    this.assertSameAttempt(existing, p, 'keyed');
    if (!existing.stripePaymentIntentId) {
      // The create never came back (a crash, or Stripe did not answer): the
      // same idempotency key asks again — Stripe answers what it did the
      // first time, or does it now. The row is back in play meanwhile.
      const row = existing.status === 'failed' ? await this.reopen(existing) : existing;
      return this.chargeKeyed(row, p, paymentMethodId);
    }
    const intent = await this.stripe.retrievePaymentIntent(existing.stripePaymentIntentId, { expandCharge: true });
    await this.handler.assertIntent(intent);
    return keyedAnswer((await this.repo.get(existing.id)) ?? existing, intent);
  }

  /** `failed` → `pending` for a typed card that is being asked again (no intent was ever recorded). */
  private async reopen(payment: Payment): Promise<Payment> {
    return this.repo
      .update(payment, { status: 'pending', updatedAt: new Date().toISOString() }, ['failureReason'], {
        expectedVersion: payment.version,
      })
      .catch(PaymentsService.conflict);
  }

  /** The same attempt id for the same thing: channel, job, document, person and amounts — 409 otherwise. */
  private assertSameAttempt(existing: Payment, p: OpenParams, channel: PaymentChannel): void {
    const { input, caller, owner } = p;
    const sameAttempt =
      existing.channel === channel &&
      existing.dealId === owner.dealId &&
      (existing.estimateId ?? null) === (owner.estimateId ?? null) &&
      existing.takenBy === caller.user.id;
    if (!sameAttempt) {
      throw new ConflictException('This payment attempt belongs to another payment — start a new attempt');
    }
    if (toCents(existing.amount) !== toCents(input.amount) || toCents(existing.tipAmount ?? 0) !== toCents(input.tipAmount)) {
      throw new ConflictException('This payment attempt was started for a different amount — start a new attempt');
    }
  }

  /** Signature first: `signedAt` on the document, or any signature row on file. */
  private async assertSigned(doc: OpenParams['document']): Promise<void> {
    if (doc.signedAt) return;
    if (this.signatures && (await this.signatures.hasAny(doc.kind, doc.id))) return;
    throw new ConflictException(SIGNATURE_REQUIRED);
  }

  /** The caller's own unconfirmed attempts on this job make way for the new one. Returns the ledger as it now stands. */
  private async supersedeOwnAttempts(dealId: string, caller: Caller, attemptId: string): Promise<Payment[]> {
    const ledger = await this.repo.listByInvoice(dealId);
    const mine = ledger.filter((p) => isOpenAttempt(p) && p.takenBy === caller.user.id && p.id !== attemptId);
    if (mine.length === 0) return ledger;
    for (const p of mine) await this.withdraw(p, 'abandoned', 'Replaced by a newer payment attempt');
    return this.repo.listByInvoice(dealId);
  }

  /**
   * Cancels an attempt's intent at Stripe and fails the row. When Stripe will
   * not cancel it — it went through, or is going through — what Stripe says
   * happened is asserted instead, so a charged card is never written off.
   */
  private async withdraw(
    payment: Payment,
    reason: 'abandoned' | 'requested_by_customer',
    failureReason: string,
  ): Promise<void> {
    try {
      await this.stripe.cancelPaymentIntent(payment.stripePaymentIntentId!, reason);
    } catch (err) {
      this.logger.warn(
        `payment ${payment.id}: intent ${payment.stripePaymentIntentId} was not cancelled (${(err as Error).message}) — asking Stripe what happened`,
      );
      await this.handler.syncIntent(payment);
      return;
    }
    await this.fail(payment, failureReason);
  }

  /**
   * `pending` → `failed` with nothing re-totalled or announced: no money
   * moved (as with a superseded portal session). A webhook that got to the
   * row first wins.
   */
  private async fail(payment: Payment, failureReason: string): Promise<void> {
    let row: Payment | null = payment;
    for (let tries = 0; tries < 2 && row?.status === 'pending'; tries++) {
      try {
        await this.repo.update(
          row,
          { status: 'failed', failureReason, updatedAt: new Date().toISOString() },
          [],
          { expectedVersion: row.version },
        );
        return;
      } catch (err) {
        if (!(err instanceof PaymentVersionConflictError)) throw err;
        row = await this.repo.get(payment.id);
      }
    }
  }

  /** A phone card attempt — tapped or typed — this caller may act on: 404 / 403 / 409 (not a phone payment) / 503. */
  private async attemptFor(paymentId: string, caller: Caller): Promise<Payment> {
    const payment = await this.payments.require(paymentId);
    await this.payments.paymentContext(payment, caller);
    if (!isPhoneChannel(payment.channel) || !payment.stripePaymentIntentId) {
      throw new ConflictException('This payment was not taken on a phone — there is no card attempt to sync or cancel');
    }
    this.requireStripe();
    return payment;
  }

  private async outcome(payment: Payment, caller: Caller): Promise<TerminalIntentOutcome> {
    return { payment, ledger: await this.payments.listForDeal(payment.dealId, caller) };
  }

  private requireStripe(): void {
    if (!this.stripe.available) {
      throw new ServiceUnavailableException(
        'Card payments on the phone are not available — Stripe is not configured for this account',
      );
    }
  }

  private requireEstimates(): EstimatesService {
    if (!this.estimates) throw new Error('EstimatesService not wired');
    return this.estimates;
  }

  private requireProfiles(): BusinessProfileService {
    if (!this.profiles) throw new Error('BusinessProfileService not wired');
    return this.profiles;
  }
}

/** Which deployment made a Stripe object (`metadata.env`) — so environments sharing an account never confuse each other's. */
export function terminalEnvTag(): string {
  return (process.env.APP_ENV || process.env.APP_DOMAIN || 'local').trim() || 'local';
}

/** What every phone card intent carries in its metadata — `paymentId` is the webhook's join. */
function intentMetadata(payment: Payment, p: OpenParams, channel: PaymentChannel): Record<string, string> {
  return {
    paymentId: payment.id,
    ...(p.document.kind === 'invoice' ? { invoiceId: p.document.id } : { estimateId: p.document.id }),
    dealId: payment.dealId,
    contactId: payment.contactId,
    channel,
    env: terminalEnvTag(),
  };
}

function parseRequest(raw: TerminalIntentRequest): Attempt {
  const attemptId = typeof raw?.attemptId === 'string' ? raw.attemptId.trim().toLowerCase() : '';
  if (!UUID.test(attemptId)) {
    throw new BadRequestException('attemptId must be a UUID the phone makes once per payment attempt');
  }
  const tip = raw.tipAmount ?? 0;
  if (typeof tip !== 'number' || !Number.isFinite(tip) || tip < 0) {
    throw new BadRequestException('The tip must be zero or more');
  }
  return { attemptId, amount: raw.amount, tipAmount: round2(tip) };
}

/** The typed card's PaymentMethod — never a card number: 400 for anything but a `pm_…` id. */
function parsePaymentMethod(raw: CardIntentRequest): string {
  const id = typeof raw?.paymentMethodId === 'string' ? raw.paymentMethodId.trim() : '';
  if (!PAYMENT_METHOD_ID.test(id)) {
    throw new BadRequestException('paymentMethodId must be the pm_… the phone made from the typed card');
  }
  return id;
}

const attemptOver = () =>
  new ConflictException('This payment attempt did not go through — start a new attempt');

const isPhoneChannel = (channel: Payment['channel']): channel is PaymentChannel =>
  channel === 'terminal' || channel === 'keyed';

/** An attempt nobody has paid with yet — tapped or typed: pending, its intent made, no charge recorded. */
const isOpenAttempt = (p: Payment): boolean =>
  isPhoneChannel(p.channel) && p.status === 'pending' && !!p.stripePaymentIntentId && !p.stripeChargeId;

/** Money that may still land: pending rows, less portal checkouts nobody confirmed. */
function pendingOf(rows: Payment[]): number {
  return summarizePayments(rows.filter((p) => !(p.status === 'pending' && p.stripeSessionId && !p.stripePaymentIntentId)))
    .pending;
}

function answer(payment: Payment, intent: Stripe.PaymentIntent): TerminalPaymentIntent {
  if (!intent.client_secret) {
    throw new ServiceUnavailableException('Stripe did not return a client secret for this payment');
  }
  const tipAmount = payment.tipAmount ?? 0;
  const feeAmount = payment.feeAmount ?? 0;
  return {
    paymentId: payment.id,
    intentId: intent.id,
    clientSecret: intent.client_secret,
    amount: payment.amount,
    tipAmount,
    feeAmount,
    total: round2(payment.amount + tipAmount + feeAmount),
    currency: payment.currency,
    status: payment.status,
  };
}

/**
 * What the phone hears for a typed card: the intent's own status, and — when
 * the card was not charged (`requires_payment_method`, `canceled`) — why.
 */
function keyedAnswer(
  payment: Payment,
  intent: Stripe.PaymentIntent | undefined,
  declineMessage?: string,
): KeyedPaymentIntent {
  const tipAmount = payment.tipAmount ?? 0;
  const feeAmount = payment.feeAmount ?? 0;
  // Stripe's own status (its SDK type also allows statuses newer than this API version).
  const status = (intent?.status ?? 'requires_payment_method') as KeyedPaymentIntent['status'];
  const notCharged = status === 'requires_payment_method' || status === 'canceled';
  const why = notCharged
    ? declineMessage || intent?.last_payment_error?.message || payment.failureReason || 'The card was not charged'
    : undefined;
  return {
    paymentId: payment.id,
    intentId: intent?.id ?? payment.stripePaymentIntentId ?? '',
    clientSecret: intent?.client_secret ?? '',
    status,
    amount: payment.amount,
    tipAmount,
    feeAmount,
    total: round2(payment.amount + tipAmount + feeAmount),
    currency: payment.currency,
    ...(why && { declineMessage: why }),
  };
}

/** The parts of a stripe-node error the typed-card path reads (`type` is the class name, e.g. `StripeCardError`). */
interface StripeErrorLike {
  type: string;
  rawType?: string;
  message: string;
  statusCode?: number;
  charge?: string;
  payment_intent?: Stripe.PaymentIntent;
}

function stripeError(err: unknown): StripeErrorLike | null {
  const type = (err as { type?: unknown } | null)?.type;
  return typeof type === 'string' && type.startsWith('Stripe') ? (err as StripeErrorLike) : null;
}

/** The company's address as a US Terminal Location takes it — or a 400 naming what is missing. */
function terminalAddress(address: Address | undefined): TerminalAddress {
  const missing = [
    !address?.street?.trim() && 'street',
    !address?.city?.trim() && 'city',
    !address?.state?.trim() && 'state',
    !address?.zip?.trim() && 'ZIP code',
  ].filter((m): m is string => !!m);
  if (missing.length) {
    throw new BadRequestException(
      `The company address is incomplete — add the ${missing.join(', ')} in Settings → Company ` +
        'before taking card payments on a phone (Stripe needs a full US address for the Tap to Pay location)',
    );
  }
  return {
    line1: address!.street.trim(),
    ...(address!.unit?.trim() && { line2: address!.unit.trim() }),
    city: address!.city.trim(),
    state: address!.state.trim(),
    postal_code: address!.zip.trim(),
    country: 'US',
  };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}
