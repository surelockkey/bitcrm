import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  estimateDepositDue,
  type Estimate,
  type OnlinePaymentMethod,
  type Payment,
  type PortalDepositOptions,
  type PortalPaymentOptions,
  type PortalPaymentSession,
} from '@bitcrm/types';
import { portalBaseUrl } from '../common/constants/services.constants';
import { CrmClient } from '../integrations/crm.client';
import { invoiceAwaitsSignature } from '../invoices/invoice-rules';
import { PortalService } from '../portal/portal.service';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentAmountError, clampPaymentAmount, round2, summarizePayments, surchargeFor } from './payment-rules';
import { PaymentsRepository } from './payments.repository';
import { StripeService } from './stripe/stripe.service';

export interface PortalPayInput {
  amount: unknown;
  method: OnlinePaymentMethod;
  /**
   * The portal path the customer is on, so Stripe returns them to exactly
   * that page. Validated to a same-origin path under the portal base URL;
   * anything else falls back to `/<token>`.
   */
  returnPath?: string;
}

/**
 * How long an unfinished Checkout Session is still considered live. Past it,
 * the reconciliation sweep fails the abandoned row on its own. Within it, a
 * new attempt SUPERSEDES the old one (the customer changed the amount) rather
 * than being refused — see `supersedeOpenSessions`.
 */
const SESSION_LOCK_MINUTES = Math.max(1, Number(process.env.BILLING_PAYMENT_SESSION_MINUTES) || 30);

/** A session the customer never confirmed: no PaymentIntent has been recorded against it. */
const isUnconfirmedSession = (p: Payment): boolean =>
  p.status === 'pending' && !!p.stripeSessionId && !p.stripePaymentIntentId;

/**
 * The client-facing half of payments: three `@Public()` routes behind the
 * portal token. Everything a client sends is advisory — the amount, the
 * method and the invoice are all re-derived and re-checked here, because the
 * only thing the caller has proved is that they hold the token.
 */
@Injectable()
export class PortalPaymentsService {
  private readonly logger = new Logger(PortalPaymentsService.name);

  constructor(
    private readonly portal: PortalService,
    private readonly repo: PaymentsRepository,
    private readonly settings: PaymentSettingsService,
    private readonly crm: CrmClient,
    @Optional() private readonly stripe?: StripeService,
  ) {}

  /** What the portal's payment panel renders. 404 unless the invoice is the token's and sent. */
  async options(token: string, invoiceId: string): Promise<PortalPaymentOptions> {
    const invoice = await this.portal.sentInvoiceFor(token, invoiceId);
    const [settings, ledger] = await Promise.all([this.settings.get(), this.repo.listByInvoice(invoice.id)]);
    const summary = summarizePayments(ledger);
    return {
      invoiceId: invoice.id,
      number: invoice.number,
      amountDue: round2(Math.max(0, (invoice.totals?.total ?? 0) - summary.settled)),
      amountPending: summary.pending,
      currency: 'usd',
      // `amountDue: 0` (settled) and `methods: []` (online payment
      // unavailable) are deliberately different states for the portal.
      methods: this.settings.methodsFor(settings, invoice.allowedMethods, !!this.stripe?.onlineReady),
      allowPartial: settings.allowPartial,
      bankMinimum: settings.bankMinimum,
      surchargePercent: settings.surchargePercent,
      surchargeLabel: settings.surchargeLabel,
      tipsEnabled: settings.tipsEnabled,
      tipPresets: settings.tipPresets,
    };
  }

  /**
   * Opens ONE Checkout Session for one attempt. The ledger row is written
   * first, `pending`, so the webhook (whose only join is the metadata) always
   * finds a payment to assert against — even if it beats this response.
   */
  async pay(token: string, invoiceId: string, input: PortalPayInput): Promise<PortalPaymentSession> {
    const invoice = await this.portal.sentInvoiceFor(token, invoiceId);
    if (!invoice.dealId) {
      // The ledger is keyed by the job; a client invoice (no job) is not payable online yet.
      throw new ConflictException('This invoice cannot be paid online yet — please contact the office');
    }
    // Signature first, money second — enforced here, not only by the portal's
    // Sign & pay drawer: a direct POST must not get around "Request signature".
    if (invoiceAwaitsSignature(invoice)) {
      throw new ConflictException('Please sign the invoice first — it is paid after signing it');
    }
    return this.openCheckout({
      token,
      input,
      dealId: invoice.dealId,
      contactId: invoice.contactId,
      companyId: invoice.companyId,
      allowedMethods: invoice.allowedMethods,
      documentId: invoice.id,
      description: `Invoice ${invoice.number}`,
      owed: (ledger) => round2(Math.max(0, (invoice.totals?.total ?? 0) - summarizePayments(ledger).settled)),
      pending: (ledger) => summarizePayments(ledger).pending,
    });
  }

  // ---------------------------------------------------------- estimate deposit

  /**
   * The "Make a deposit" step of approving an estimate (Workiz "Required
   * deposit"). 404 unless the estimate is the token's and sent.
   */
  async depositOptions(token: string, estimateId: string): Promise<PortalDepositOptions> {
    const estimate = await this.portal.sentEstimateFor(token, estimateId);
    const settings = await this.settings.get();
    const deposit = estimate.dealId ? depositLedger(await this.repo.listByInvoice(estimate.dealId), estimate.id) : [];
    const summary = summarizePayments(deposit);
    const depositDue = estimateDepositDue(estimate);
    return {
      estimateId: estimate.id,
      number: estimate.number,
      depositDue,
      amountPaid: summary.settled,
      amountDue: round2(Math.max(0, depositDue - summary.settled)),
      amountPending: summary.pending,
      signed: estimate.status === 'approved',
      currency: 'usd',
      // No deposit, or no job to hold the money ⇒ nothing can be paid.
      methods:
        depositDue > 0 && estimate.dealId ? this.settings.methodsFor(settings, undefined, !!this.stripe?.onlineReady) : [],
      allowPartial: settings.allowPartial,
      bankMinimum: settings.bankMinimum,
      surchargePercent: settings.surchargePercent,
      surchargeLabel: settings.surchargeLabel,
    };
  }

  /**
   * Signature first, money second: a deposit is only taken on an estimate the
   * client has approved (= signed). The payment goes on the JOB's ledger —
   * Workiz applies a deposit to the job's balance, and so to its invoice —
   * tagged with the estimate so the deposit step knows what was paid.
   */
  async payDeposit(token: string, estimateId: string, input: PortalPayInput): Promise<PortalPaymentSession> {
    const estimate = await this.portal.sentEstimateFor(token, estimateId);
    const depositDue = estimateDepositDue(estimate);
    if (!(depositDue > 0)) throw new BadRequestException('This estimate does not ask for a deposit');
    if (!estimate.dealId) {
      throw new ConflictException('This estimate cannot take a deposit online yet — please contact the office');
    }
    if (estimate.status !== 'approved') {
      throw new ConflictException('Please sign the estimate first — the deposit is paid after approving it');
    }
    const dealId = estimate.dealId;
    return this.openCheckout({
      token,
      input,
      dealId,
      contactId: estimate.contactId,
      companyId: estimate.companyId,
      allowedMethods: undefined,
      documentId: estimate.id,
      estimateId: estimate.id,
      description: `Deposit for estimate ${estimate.number}`,
      owed: (ledger) => round2(Math.max(0, depositDue - summarizePayments(depositLedger(ledger, estimate.id)).settled)),
      pending: (ledger) => summarizePayments(depositLedger(ledger, estimate.id)).pending,
    });
  }

  /**
   * Opens ONE Checkout Session for one attempt. The ledger row is written
   * first, `pending`, so the webhook (whose only join is the metadata) always
   * finds a payment to assert against — even if it beats this response.
   */
  private async openCheckout(params: {
    token: string;
    input: PortalPayInput;
    dealId: string;
    contactId: string;
    companyId?: string;
    allowedMethods?: OnlinePaymentMethod[];
    /** The invoice or estimate the client is paying for (the return URL). */
    documentId: string;
    estimateId?: string;
    description: string;
    /** What is still owed, given the job's ledger as it now stands. */
    owed: (ledger: Payment[]) => number;
    /** Confirmed money still clearing, which caps a second attempt. */
    pending: (ledger: Payment[]) => number;
  }): Promise<PortalPaymentSession> {
    const { token, input, dealId } = params;
    const settings = await this.settings.get();

    if (!this.stripe?.onlineReady) {
      throw new ServiceUnavailableException('Online payments are not available right now');
    }
    const methods = this.settings.methodsFor(settings, params.allowedMethods, true);
    if (!methods.includes(input.method)) {
      throw new BadRequestException('That payment method is not available for this document');
    }

    // A re-POST means the customer changed their mind about the amount: the
    // half-finished session is abandoned, not the new request refused.
    const ledger = await this.supersedeOpenSessions(await this.repo.listByInvoice(dealId));
    const amountDue = params.owed(ledger);
    const pending = params.pending(ledger);
    // Money already confirmed and merely clearing (ACH) is not deducted from
    // `amountDue` — the client is shown it separately — but it DOES cap what
    // a second attempt may add, or the document would be over-collected.
    const ceiling = round2(amountDue - pending);
    if (amountDue > 0 && ceiling <= 0) {
      throw new ConflictException(
        `A bank payment of $${pending.toFixed(2)} is still clearing — ` +
          'nothing more is owed until it lands or is returned',
      );
    }

    let amount: number;
    try {
      amount = clampPaymentAmount({
        requested: input.amount,
        amountDue: amountDue > 0 ? ceiling : 0,
        allowPartial: settings.allowPartial,
        method: input.method,
        bankMinimum: settings.bankMinimum,
      });
    } catch (err) {
      if (err instanceof PaymentAmountError) throw new BadRequestException(err.message);
      throw err;
    }

    const surcharge = input.method === 'card' ? surchargeFor(amount, settings.surchargePercent) : 0;
    const now = new Date().toISOString();
    const payment: Payment = {
      id: randomUUID(),
      invoiceId: dealId,
      dealId,
      ...(params.estimateId && { estimateId: params.estimateId }),
      contactId: params.contactId,
      ...(params.companyId && { companyId: params.companyId }),
      amount,
      currency: 'usd',
      method: input.method,
      status: 'pending',
      refundedAmount: 0,
      ...(surcharge > 0 && { feeAmount: surcharge }),
      source: 'portal',
      takenBy: 'client',
      takenAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(payment);

    const contact = await this.crm.getContact(params.contactId).catch(() => null);
    const email = contact?.emails?.[0];

    let session: { sessionId: string; clientSecret: string; paymentIntentId?: string };
    try {
      session = await this.stripe.createCheckoutSession({
        paymentId: payment.id,
        invoiceId: dealId,
        dealId,
        contactId: params.contactId,
        amount,
        surcharge,
        surchargeLabel: settings.surchargeLabel,
        currency: 'usd',
        description: params.description,
        method: input.method,
        returnUrl: this.returnUrl(token, input.returnPath, payment.id, params.documentId),
        ...(email && { customerEmail: email }),
        idempotencyKey: `checkout_${payment.id}`,
      });
    } catch (err) {
      // No session means no way to pay: drop the row rather than leave a
      // phantom "clearing" line on the client's document.
      await this.repo.delete(payment).catch(() => undefined);
      throw err;
    }

    // Only the session id is recorded here. `stripePaymentIntentId` is the
    // marker that the customer actually CONFIRMED, written by the webhook (or
    // the reconciliation sweep) — which is what keeps a superseding re-POST
    // from cancelling a bank payment that is genuinely on its way.
    await this.repo.update(payment, {
      stripeSessionId: session.sessionId,
      updatedAt: new Date().toISOString(),
    });
    await this.repo.putStripePointer(session.sessionId, payment.id);

    return {
      clientSecret: session.clientSecret,
      publishableKey: this.stripe.publishableKey,
      paymentId: payment.id,
      amount,
      surcharge,
      tip: 0,
      total: round2(amount + surcharge),
      currency: 'usd',
    };
  }

  /** Polled after the client returns from the Payment Element. */
  async status(
    token: string,
    paymentId: string,
  ): Promise<{ status: Payment['status']; amount: number; method: Payment['method']; receiptSent: boolean }> {
    const contactId = await this.portal.resolveContact(token);
    const payment = await this.repo.get(paymentId);
    // Same answer for "not yours" and "doesn't exist".
    if (!payment || payment.contactId !== contactId) throw new NotFoundException('Payment not found');
    return {
      status: payment.status,
      amount: payment.amount,
      method: payment.method,
      // Receipts are not sent from billing (messaging owns client comms).
      receiptSent: false,
    };
  }

  /**
   * One open session per invoice, enforced by SUPERSEDING rather than
   * refusing: a customer who edits the amount and pays again must succeed,
   * and two live sessions on one invoice would let them pay twice. Only
   * sessions the customer never confirmed are cancelled — a bank payment that
   * is already on its way keeps its row (and caps the new amount instead).
   *
   * Returns the ledger as it now stands.
   */
  private async supersedeOpenSessions(ledger: Payment[]): Promise<Payment[]> {
    const cutoff = Date.now() - SESSION_LOCK_MINUTES * 60_000;
    const stale = ledger.filter((p) => isUnconfirmedSession(p) && Date.parse(p.createdAt) > cutoff);
    if (stale.length === 0) return ledger.filter((p) => !isUnconfirmedSession(p) || p.status !== 'pending');

    const superseded = new Set<string>();
    for (const p of stale) {
      try {
        if (p.stripeSessionId) await this.stripe?.expireSession(p.stripeSessionId);
        await this.repo.update(
          p,
          {
            status: 'failed',
            failureReason: 'Replaced by a newer payment attempt',
            updatedAt: new Date().toISOString(),
          },
          [],
          { expectedVersion: p.version },
        );
        superseded.add(p.id);
      } catch (err) {
        // Someone (a webhook) got there first — leave their answer alone and
        // let the amount ceiling below do the protecting.
        this.logger.warn(`superseding payment ${p.id} failed: ${(err as Error).message}`);
      }
    }
    return ledger.filter((p) => !superseded.has(p.id));
  }

  /**
   * Back to the exact portal page the customer was on, carrying both ids —
   * the portal strips them from the URL and resumes polling.
   */
  private returnUrl(token: string, returnPath: string | undefined, paymentId: string, invoiceId: string): string {
    const base = portalBaseUrl();
    const path = safePortalPath(returnPath, token);
    const query = `payment=${encodeURIComponent(paymentId)}&invoice=${encodeURIComponent(invoiceId)}`;
    return `${base}${path}?${query}`;
  }
}

/** Exported for the controller's OpenAPI description. */
export const PORTAL_SESSION_LOCK_MINUTES = SESSION_LOCK_MINUTES;

/**
 * A return path is customer-supplied, so it is only ever used as a PATH under
 * the portal's own origin: no scheme, no host, no traversal, and it must be
 * inside this token's space.
 */
export function safePortalPath(raw: string | undefined, token: string): string {
  const fallback = `/${token}`;
  if (!raw) return fallback;
  const path = raw.split('?')[0].split('#')[0];
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.includes('\\')) return fallback;
  return path === `/${token}` || path.startsWith(`/${token}/`) ? path : fallback;
}

/** The rows of a job's ledger that are deposits on ONE estimate. */
export function depositLedger(ledger: Payment[], estimateId: string): Payment[] {
  return ledger.filter((p) => p.estimateId === estimateId);
}
