import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BillingEventType,
  TimelineEventType,
  type Deal,
  type Invoice,
  type JobPaymentLedger,
  type OnlinePaymentMethod,
  type Payment,
  type PaymentMethod,
  type PaymentRefund,
  type PaymentStatus,
  type PaymentSummary,
  type RefundStatus,
} from '@bitcrm/types';
import { assertDealAccess, isAssignedOnly, type Caller } from '../common/access';
import { BillingEventsPublisher } from '../integrations/billing-events.publisher';
import { CrmClient } from '../integrations/crm.client';
import { DealClient, type DealBillingView } from '../integrations/deal.client';
import { computeInvoiceTotals } from '../invoices/invoice-rules';
import { MessagingClient } from '../integrations/messaging.client';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentSettingsService } from './payment-settings.service';
import {
  PaymentAmountError,
  amountPaidFrom,
  clampPaymentAmount,
  dealPaymentStatus,
  refundableAmount,
  round2,
  statusAfterRefund,
  summarizePayments,
} from './payment-rules';
import { PaymentVersionConflictError, PaymentsRepository, type PaymentListFilter } from './payments.repository';
import { StripeService } from './stripe/stripe.service';

/** Methods staff can record by hand. `bank` is online-only (it settles through Stripe). */
export const OFFLINE_PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'check', 'card', 'other'];

export interface RecordPaymentInput {
  amount: number;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  takenAt?: string;
}

export interface RefundInput {
  amount?: number;
  reason?: string;
  sendReceipt?: boolean;
}

export interface InvoiceLedger {
  payments: Payment[];
  summary: PaymentSummary;
}

/** The invoice + job a payment hangs off, after the caller's scope was checked. */
interface PaymentContext {
  invoice: Invoice;
  deal: Pick<Deal, 'id' | 'assignedTechIds' | 'contactId'>;
}

/**
 * The job a ledger hangs off, after the caller's scope was checked — with its
 * invoice when it has one. In Workiz a payment belongs to the JOB; an invoice
 * is a separate document, so `invoice` is legitimately `null` here.
 */
interface JobContext {
  invoice: Invoice | null;
  view: DealBillingView;
}

/** Who a new payment row belongs to. `invoiceId` is always the job id. */
interface PaymentOwner {
  invoiceId: string;
  dealId: string;
  contactId: string;
  companyId?: string;
}

/**
 * The payment ledger. Every path in and out of it ends in `syncLedger`, which
 * is the single place the money is re-totalled: re-read the ledger, hand the
 * sum to the invoice (which re-derives its own status), tell the job board,
 * write the job timeline and publish the event. Nothing anywhere applies a
 * delta to a stored total.
 */
/** Ledgers read at once by `ledgersByDeals`. */
const LEDGER_READ_CONCURRENCY = 10;
/** The DTO's cap, held here too: the body is not validated on every deployment. */
const LEDGERS_MAX_DEALS = 100;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly invoices: InvoicesService,
    private readonly settings: PaymentSettingsService,
    private readonly deal: DealClient,
    @Optional() private readonly stripe?: StripeService,
    @Optional() private readonly events?: BillingEventsPublisher,
    @Optional() private readonly crm?: CrmClient,
    @Optional() private readonly messaging?: MessagingClient,
  ) {}

  // -------------------------------------------------------------- ledger read

  async listForInvoice(invoiceId: string, caller: Caller): Promise<InvoiceLedger> {
    await this.context(invoiceId, caller);
    return this.ledger(invoiceId);
  }

  /** No access check — the portal and the invoice view have already proved theirs. */
  async ledger(invoiceId: string): Promise<InvoiceLedger> {
    const rows = await this.repo.listByInvoice(invoiceId);
    const payments = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { payments, summary: summarizePayments(rows) };
  }

  /**
   * Several jobs' ledgers at once, keyed by job id (`[]` for a job with no
   * payments) — deal-service's commissions report splits them into Workiz's
   * Cash / Credit / Check columns. Internal only, so no access check; a few
   * jobs are read at a time so a page of a report cannot flood the table.
   */
  async ledgersByDeals(dealIds: string[]): Promise<Record<string, Payment[]>> {
    const ids = Array.isArray(dealIds) ? dealIds.filter((id) => typeof id === 'string' && id) : [];
    const unique = [...new Set(ids)].slice(0, LEDGERS_MAX_DEALS);
    const out: Record<string, Payment[]> = {};
    for (let i = 0; i < unique.length; i += LEDGER_READ_CONCURRENCY) {
      const batch = unique.slice(i, i + LEDGER_READ_CONCURRENCY);
      const ledgers = await Promise.all(batch.map((id) => this.repo.listByInvoice(id)));
      batch.forEach((id, n) => (out[id] = ledgers[n]));
    }
    return out;
  }

  /**
   * The job's Payments tab (Workiz). Works with or without an invoice: the
   * ledger is keyed by the job id (invoice id === deal id), so a job that was
   * never invoiced still has its payments, and an invoice created for it later
   * picks them up as its `amountPaid`.
   */
  async listForDeal(dealId: string, caller: Caller): Promise<JobPaymentLedger> {
    const ctx = await this.jobContext(dealId, caller);
    const { payments, summary } = await this.ledger(ctx.view.deal.id);
    const total = jobTotal(ctx.view, summary.settled);
    return {
      dealId: ctx.view.deal.id,
      ...(ctx.invoice && { invoiceId: ctx.invoice.id }),
      payments,
      summary,
      total,
      amountPaid: summary.settled,
      balanceDue: balanceOf(total, summary.settled),
    };
  }

  /**
   * The report. `summary` covers the WHOLE filtered range, not the page — it
   * is what the Collected / Clearing / Refunded strip reads — so it is
   * computed only on the first page (no cursor), where the strip asks for it.
   */
  async list(
    query: Omit<PaymentListFilter, 'limit'> & { limit?: number },
    caller: Caller,
  ): Promise<{ items: Payment[]; nextCursor?: string; summary?: PaymentSummary }> {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const result = await this.repo.list({ ...query, limit });
    const mine = isAssignedOnly(caller, 'payments') ? await this.deal.listDealIdsByTech(caller.user.id) : null;
    const visible = mine ? result.items.filter((p) => mine.has(p.dealId)) : result.items;

    if (query.cursor) return { ...result, items: visible };
    const { limit: _l, cursor: _c, ...range } = { ...query, limit, cursor: query.cursor };
    const all = await this.repo.listAllMatching(range);
    return {
      ...result,
      items: visible,
      summary: summarizePayments(mine ? all.filter((p) => mine.has(p.dealId)) : all),
    };
  }

  /**
   * Re-sends the client their receipt. Billing never texts or emails anyone
   * itself — messaging owns client comms, and it is called on the CALLER's
   * bearer, exactly as the web app's "Send by text" dialog does.
   */
  async sendReceipt(
    paymentId: string,
    caller: Caller,
    authorization?: string,
  ): Promise<{ sent: boolean; sentTo?: string }> {
    const payment = await this.require(paymentId);
    const { invoice, view } = await this.paymentContext(payment, caller);
    if (payment.status !== 'settled' && payment.status !== 'refunded') {
      throw new ConflictException('There is no receipt to send until the payment has been collected');
    }
    if (!this.messaging || !this.crm || !authorization) return { sent: false };

    const contact = await this.crm.getContact(payment.contactId).catch(() => null);
    const phone = contact?.phones?.[0];
    const email = contact?.emails?.[0];
    const sentTo = phone || email;
    if (!sentTo) return { sent: false };

    const refunded = (payment.refundedAmount ?? 0) > 0;
    // A job without an invoice (Workiz: payments belong to the job) is named by its number.
    const what = invoice ? `invoice ${invoice.number}` : `job ${view.deal.dealNumber}`;
    const balanceDue = invoice
      ? invoice.totals?.balanceDue ?? 0
      : await this.jobBalance(view, payment.invoiceId);
    const body =
      `Receipt for ${what}: $${payment.amount.toFixed(2)} received ` +
      `(${payment.method}) on ${payment.takenAt.slice(0, 10)}.` +
      (refunded ? ` $${(payment.refundedAmount ?? 0).toFixed(2)} of it has been refunded.` : '') +
      ` Balance due: $${balanceDue.toFixed(2)}.`;

    await this.messaging.sendToContact(
      {
        contactId: payment.contactId,
        channel: phone ? 'sms' : 'email',
        body,
        ...(phone ? {} : { subject: `Payment receipt — ${what}` }),
      },
      authorization,
    );
    return { sent: true, sentTo };
  }

  // ------------------------------------------------------------ offline write

  /** Cash, a cheque, a card taken in person. Settled the moment it is recorded. */
  async recordOffline(invoiceId: string, input: RecordPaymentInput, caller: Caller): Promise<Payment> {
    const { invoice } = await this.context(invoiceId, caller);
    assertOfflineMethod(input.method);
    return this.writeOffline(invoiceOwner(invoice), await this.amountDue(invoice), input, caller);
  }

  /**
   * The job's "Add payment" (Workiz). With an invoice it is exactly
   * `recordOffline`; without one the payment still lands in the job's ledger
   * (invoice id === deal id) and the balance is the job's own total.
   */
  async recordOfflineForDeal(dealId: string, input: RecordPaymentInput, caller: Caller): Promise<Payment> {
    const ctx = await this.jobContext(dealId, caller);
    assertOfflineMethod(input.method);
    if (ctx.invoice) {
      return this.writeOffline(invoiceOwner(ctx.invoice), await this.amountDue(ctx.invoice), input, caller);
    }
    const deal = ctx.view.deal;
    const paid = amountPaidFrom(await this.repo.listByInvoice(deal.id));
    const owner: PaymentOwner = {
      invoiceId: deal.id,
      dealId: deal.id,
      contactId: deal.contactId,
      ...(deal.companyId && { companyId: deal.companyId }),
    };
    return this.writeOffline(owner, balanceOf(jobTotal(ctx.view, paid), paid), input, caller);
  }

  private async writeOffline(
    owner: PaymentOwner,
    amountDue: number,
    input: RecordPaymentInput,
    caller: Caller,
  ): Promise<Payment> {
    const amount = this.clamp(input.amount, amountDue);
    const now = new Date().toISOString();
    const takenInTheField = isAssignedOnly(caller, 'payments');

    const payment: Payment = {
      id: randomUUID(),
      ...owner,
      amount,
      currency: 'usd',
      method: input.method,
      status: 'settled',
      refundedAmount: 0,
      source: takenInTheField ? 'field' : 'office',
      ...(input.reference && { reference: input.reference }),
      ...(input.note && { note: input.note }),
      takenBy: caller.user.id,
      takenAt: input.takenAt || now,
      settledAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(payment);
    await this.syncLedger(payment, {
      event: BillingEventType.PAYMENT_SUCCEEDED,
      timeline: TimelineEventType.PAYMENT_RECEIVED,
      actorId: caller.user.id,
      actorName: caller.user.email,
    });
    return payment;
  }

  /** Removes a mis-keyed OFFLINE payment. A Stripe payment is refunded, never deleted. */
  async remove(paymentId: string, caller: Caller): Promise<void> {
    const payment = await this.require(paymentId);
    await this.paymentContext(payment, caller);
    if (isStripeBacked(payment)) {
      throw new ConflictException('This payment went through Stripe — refund it instead of deleting it');
    }
    await this.repo.delete(payment);
    await this.syncLedger(payment, {
      event: BillingEventType.PAYMENT_REFUNDED,
      timeline: TimelineEventType.PAYMENT_REFUNDED,
      actorId: caller.user.id,
      actorName: caller.user.email,
      metadata: { deleted: true },
    });
  }

  // ----------------------------------------------------------------- refunds

  async refund(paymentId: string, input: RefundInput, caller: Caller): Promise<PaymentRefund> {
    const payment = await this.require(paymentId);
    await this.paymentContext(payment, caller);

    const remaining = refundableAmount(payment);
    if (remaining <= 0) {
      throw new ConflictException(
        payment.status === 'refunded'
          ? 'This payment has already been refunded in full'
          : 'Only collected money can be refunded',
      );
    }
    const requested = input.amount === undefined ? remaining : input.amount;
    if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
      throw new BadRequestException('Enter a refund amount greater than zero');
    }
    const amount = round2(requested);
    if (amount > remaining) {
      throw new BadRequestException(`Only $${remaining.toFixed(2)} of this payment can still be refunded`);
    }

    const now = new Date().toISOString();
    const refundId = randomUUID();
    let status: RefundStatus = 'succeeded';
    let stripeRefundId: string | undefined;
    let failureReason: string | undefined;

    if (isStripeBacked(payment)) {
      if (!payment.stripePaymentIntentId) {
        throw new ConflictException('This payment has no Stripe PaymentIntent to refund');
      }
      if (!this.stripe?.available) {
        throw new ConflictException('Online payments are not configured — this refund must be issued in Stripe');
      }
      const refund = await this.stripe.createRefund({
        paymentIntentId: payment.stripePaymentIntentId,
        amount,
        reason: input.reason,
        idempotencyKey: `refund_${refundId}`,
      });
      stripeRefundId = refund.id;
      status = mapRefundStatus(refund.status);
      failureReason = refund.failure_reason ?? undefined;
    }

    const record: PaymentRefund = {
      id: refundId,
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      amount,
      ...(input.reason && { reason: input.reason }),
      status,
      ...(stripeRefundId && { stripeRefundId }),
      ...(failureReason && { failureReason }),
      refundedBy: caller.user.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.addRefund(record);

    if (status === 'failed' || status === 'canceled') return record;

    const refundedAmount = round2((payment.refundedAmount ?? 0) + amount);
    const updated = await this.repo.update(
      payment,
      {
        refundedAmount,
        status: statusAfterRefund(payment, refundedAmount),
        updatedAt: now,
      },
      [],
      { expectedVersion: payment.version },
    );
    await this.syncLedger(updated, {
      event: BillingEventType.PAYMENT_REFUNDED,
      timeline: TimelineEventType.PAYMENT_REFUNDED,
      actorId: caller.user.id,
      actorName: caller.user.email,
      metadata: { refundId: record.id, amount },
    });
    if (input.sendReceipt) {
      // Billing has no email transport; messaging owns client comms.
      this.logger.log(`refund ${record.id}: a receipt was requested but receipts are not sent from billing`);
    }
    return record;
  }

  // -------------------------------------------------------------- allowed methods

  /** Workiz "Let client pay with", chosen on the document at send time. */
  async setAllowedMethods(
    invoiceId: string,
    methods: OnlinePaymentMethod[] | null,
    caller: Caller,
  ): Promise<Invoice> {
    await this.context(invoiceId, caller);
    return this.invoices.setAllowedMethods(invoiceId, methods);
  }

  // ------------------------------------------------------------------ internals

  /**
   * The ONE place a ledger change is propagated. Re-reads the ledger (never a
   * delta), re-derives the invoice from it, then tells the job board, the job
   * timeline and the event bus — all best effort, because none of them may
   * fail a payment that has already been taken.
   */
  async syncLedger(
    payment: Payment,
    opts: {
      event: BillingEventType;
      timeline?: TimelineEventType;
      actorId: string;
      actorName?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const rows = await this.repo.listByInvoice(payment.invoiceId);
    const amountPaid = amountPaidFrom(rows);
    const summary = summarizePayments(rows);
    const invoice = await this.invoices.applyAmountPaid(payment.invoiceId, amountPaid).catch((err: Error) => {
      this.logger.error(`invoice ${payment.invoiceId} could not be re-derived: ${err.message}`);
      return null;
    });
    let total = invoice?.totals?.total ?? 0;
    let balanceDue = invoice?.totals?.balanceDue ?? 0;
    if (!invoice) {
      // No invoice (Workiz: the payment belongs to the job) — the job's own
      // total is what the payment is measured against.
      const view = await this.deal.getBillingView(payment.dealId).catch((err: Error) => {
        this.logger.warn(`deal ${payment.dealId} billing view unavailable: ${err.message}`);
        return null;
      });
      if (view) {
        total = jobTotal(view, amountPaid);
        balanceDue = balanceOf(total, amountPaid);
      }
    }

    await this.deal
      .setPaymentStatus(payment.dealId, {
        paymentStatus: dealPaymentStatus(amountPaid, total),
        amountPaid,
        invoiceTotal: total,
        ...(summary.lastPaymentAt && { paidAt: summary.lastPaymentAt }),
        paymentId: payment.id,
      })
      .catch((err: Error) => this.logger.warn(`deal ${payment.dealId} payment status not updated: ${err.message}`));

    if (opts.timeline) {
      await this.deal.addTimeline(
        payment.dealId,
        opts.timeline,
        opts.actorId,
        {
          paymentId: payment.id,
          amount: payment.amount,
          method: payment.method,
          status: payment.status,
          balanceDue,
          ...opts.metadata,
        },
        opts.actorName,
      );
    }

    this.events?.payment(opts.event, {
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      dealId: payment.dealId,
      contactId: payment.contactId,
      amount: payment.amount,
      method: payment.method,
      status: payment.status,
      balanceDue,
    });
  }

  /** What is still owed on an invoice, ledger included. */
  async amountDue(invoice: Invoice): Promise<number> {
    const rows = await this.repo.listByInvoice(invoice.id);
    return round2(Math.max(0, (invoice.totals?.total ?? 0) - amountPaidFrom(rows)));
  }

  async require(paymentId: string): Promise<Payment> {
    const payment = await this.repo.get(paymentId);
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  /** The invoice + its job, with the caller's `assigned_only` scope enforced. */
  private async context(invoiceId: string, caller: Caller): Promise<PaymentContext> {
    const invoice = await this.invoices.getStored(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const view = await this.deal.getBillingView(invoice.dealId);
    if (!view) throw new NotFoundException('Job not found');
    assertDealAccess(caller, 'payments', view.deal);
    return { invoice, deal: view.deal };
  }

  /**
   * The job + its invoice if it has one, with the caller's `assigned_only`
   * scope enforced. The job-level twin of `context`, which insists on an invoice.
   */
  private async jobContext(dealId: string, caller: Caller): Promise<JobContext> {
    const view = await this.deal.getBillingView(dealId);
    if (!view) throw new NotFoundException('Job not found');
    assertDealAccess(caller, 'payments', view.deal);
    const invoice = await this.invoices.getStored(view.deal.id);
    return { invoice, view };
  }

  /**
   * The scope check for a payment that already exists. Its invoice may never
   * have existed (a job paid without one, as in Workiz), so the job decides.
   */
  private async paymentContext(payment: Payment, caller: Caller): Promise<JobContext> {
    const invoice = await this.invoices.getStored(payment.invoiceId);
    const view = await this.deal.getBillingView(invoice?.dealId ?? payment.dealId);
    if (!view) throw new NotFoundException(invoice ? 'Job not found' : 'Invoice not found');
    assertDealAccess(caller, 'payments', view.deal);
    return { invoice, view };
  }

  private async jobBalance(view: DealBillingView, ledgerId: string): Promise<number> {
    const paid = amountPaidFrom(await this.repo.listByInvoice(ledgerId));
    return balanceOf(jobTotal(view, paid), paid);
  }

  private clamp(requested: unknown, amountDue: number): number {
    try {
      return clampPaymentAmount({
        requested,
        amountDue,
        allowPartial: true,
        method: 'card',
        bankMinimum: 0,
      });
    } catch (err) {
      if (err instanceof PaymentAmountError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** Surfaces the optimistic-concurrency refusal as something a caller can act on. */
  static conflict(err: unknown): never {
    if (err instanceof PaymentVersionConflictError) {
      throw new ConflictException('This payment changed meanwhile — reload and try again');
    }
    throw err;
  }
}

/** The job's total, by the same formula its invoice would use. */
function jobTotal(view: DealBillingView, amountPaid: number): number {
  return computeInvoiceTotals(view, { amountPaid }).total ?? 0;
}

const balanceOf = (total: number, amountPaid: number): number => round2(Math.max(0, total - amountPaid));

const invoiceOwner = (invoice: Invoice): PaymentOwner => ({
  invoiceId: invoice.id,
  dealId: invoice.dealId,
  contactId: invoice.contactId,
  ...(invoice.companyId && { companyId: invoice.companyId }),
});

function assertOfflineMethod(method: PaymentMethod): void {
  if (!OFFLINE_PAYMENT_METHODS.includes(method)) {
    throw new BadRequestException(
      `Record a payment as one of: ${OFFLINE_PAYMENT_METHODS.join(', ')} (bank payments settle through the portal)`,
    );
  }
}

export const isStripeBacked = (p: Pick<Payment, 'stripePaymentIntentId' | 'stripeSessionId' | 'stripeChargeId'>) =>
  !!(p.stripePaymentIntentId || p.stripeSessionId || p.stripeChargeId);

/** Stripe's refund states, narrowed to ours. `requires_action` is still in flight. */
export function mapRefundStatus(status: string | null | undefined): RefundStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return 'pending';
  }
}

/** Exported for the webhook handlers, which assert states rather than compute them. */
export type { PaymentStatus };
