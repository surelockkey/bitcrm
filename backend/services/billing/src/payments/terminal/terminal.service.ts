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
  type Payment,
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

/** The exact copy the phone keys its "back to the signature" step on. */
export const SIGNATURE_REQUIRED = 'A signature is required before payment';

/** `Payment.transactionMethod` of a tapped card (the Payments report's column). */
const TRANSACTION_METHOD = 'Tap to Pay';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
 * Stripe Terminal on a staff phone (Tap to Pay), the Workiz way: the client
 * signs first, then the card is tapped — never the other way round.
 *
 * One attempt, end to end:
 *  1. `open*` writes the ledger row FIRST (`pending`, `channel: terminal`, the
 *     tip on it), then creates a `card_present` PaymentIntent for
 *     `amount + tip` with `metadata.paymentId`, and records the intent on the
 *     row and as a `STRIPE#` pointer — so every webhook finds its payment.
 *  2. The phone collects and confirms on the device (capture is automatic).
 *  3. `sync` asks Stripe right away and asserts the outcome through the
 *     webhook's own path; the webhook and the reconciliation sweep land the
 *     same answer later, as no-ops.
 *
 * A retried POST (same `attemptId`) answers the same row and intent. A new
 * attempt by the same person on the same job replaces their unconfirmed one
 * (cancelled at Stripe first, so it can never be charged); money that may
 * still land caps what a new attempt may take.
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

  /** A card on the job's invoice: up to its balance, plus any tip. */
  async openForInvoice(invoiceId: string, request: TerminalIntentRequest, caller: Caller): Promise<TerminalPaymentIntent> {
    const input = parseRequest(request);
    this.requireStripe();
    const { invoice, deal } = await this.payments.jobInvoiceFor(invoiceId, caller);
    return this.open({
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
    });
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
    return this.open({
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
    });
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

  /** Right after the tap: what Stripe says now, asserted the webhook's way, with the job's ledger. */
  async sync(paymentId: string, caller: Caller): Promise<TerminalIntentOutcome> {
    const payment = await this.attemptFor(paymentId, caller);
    await this.handler.syncIntent(payment);
    return this.outcome(await this.payments.require(paymentId), caller);
  }

  // ------------------------------------------------------------- internals

  private async open(p: OpenParams): Promise<TerminalPaymentIntent> {
    const { caller, input } = p;
    const existing = await this.repo.get(input.attemptId);
    if (existing) return this.replay(existing, p);

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
      channel: 'terminal',
      transactionMethod: TRANSACTION_METHOD,
      takenBy: caller.user.id,
      takenAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.repo.create(payment);
    } catch (err) {
      // The same attempt posted twice at once: answer what the other request wrote.
      const raced = await this.repo.get(payment.id);
      if (raced) return this.replay(raced, p);
      throw err;
    }
    return this.attachIntent(payment, p);
  }

  /** The intent for a row that exists — created under the attempt's idempotency key. */
  private async attachIntent(payment: Payment, p: OpenParams): Promise<TerminalPaymentIntent> {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.createTerminalIntent({
        amount: payment.amount,
        tipAmount: payment.tipAmount ?? 0,
        feeAmount: payment.feeAmount ?? 0,
        currency: payment.currency,
        description: p.description,
        metadata: {
          paymentId: payment.id,
          ...(p.document.kind === 'invoice' ? { invoiceId: p.document.id } : { estimateId: p.document.id }),
          dealId: payment.dealId,
          contactId: payment.contactId,
          channel: 'terminal',
          env: terminalEnvTag(),
        },
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

  /** A retried POST: the same row and the same intent — or 409 when the attempt id means something else. */
  private async replay(existing: Payment, p: OpenParams): Promise<TerminalPaymentIntent> {
    const { input, caller, owner } = p;
    const sameAttempt =
      existing.channel === 'terminal' &&
      existing.dealId === owner.dealId &&
      (existing.estimateId ?? null) === (owner.estimateId ?? null) &&
      existing.takenBy === caller.user.id;
    if (!sameAttempt) {
      throw new ConflictException('This payment attempt belongs to another payment — start a new attempt');
    }
    if (toCents(existing.amount) !== toCents(input.amount) || toCents(existing.tipAmount ?? 0) !== toCents(input.tipAmount)) {
      throw new ConflictException('This payment attempt was started for a different amount — start a new attempt');
    }
    // A failed attempt is not handed out again: a new one re-checks the
    // balance and the signature. (A decline is retried on the device with the
    // intent it already holds — that needs no POST.)
    if (existing.status === 'failed') throw attemptOver();
    // The row was written but the intent never was (a crash in between).
    if (!existing.stripePaymentIntentId) return this.attachIntent(existing, p);

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

  /** A Terminal attempt this caller may act on: 404 / 403 / 409 (not a phone payment) / 503. */
  private async attemptFor(paymentId: string, caller: Caller): Promise<Payment> {
    const payment = await this.payments.require(paymentId);
    await this.payments.paymentContext(payment, caller);
    if (payment.channel !== 'terminal' || !payment.stripePaymentIntentId) {
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

const attemptOver = () =>
  new ConflictException('This payment attempt did not go through — start a new attempt');

/** An attempt nobody has paid with yet: pending, its intent made, no charge recorded. */
const isOpenAttempt = (p: Payment): boolean =>
  p.channel === 'terminal' && p.status === 'pending' && !!p.stripePaymentIntentId && !p.stripeChargeId;

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
