import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { tryNormalizePhone } from '@bitcrm/shared';
import {
  BillingEventType,
  TimelineEventType,
  estimateDepositDue,
  type Deal,
  type Invoice,
  type JobPaymentLedger,
  type OnlinePaymentMethod,
  type Payment,
  type PaymentMethod,
  type PaymentReceiptRequest,
  type PaymentReceiptResult,
  type PaymentRefund,
  type PaymentStatus,
  type PaymentSummary,
  type RefundStatus,
} from '@bitcrm/types';
import { isEmail } from 'class-validator';
import { BusinessProfileService } from '../business-profile/business-profile.service';
import { assertDealAccess, isAssignedOnly, type Caller } from '../common/access';
import { EstimatesService } from '../estimates/estimates.service';
import { BillingEventsPublisher } from '../integrations/billing-events.publisher';
import { CrmClient } from '../integrations/crm.client';
import { DealClient, type DealBillingView } from '../integrations/deal.client';
import { computeInvoiceTotals } from '../invoices/invoice-rules';
import { MessagingClient } from '../integrations/messaging.client';
import { InvoicesService } from '../invoices/invoices.service';
import { RECEIPT_E164 } from './dto/send-receipt.dto';
import { PaymentSettingsService } from './payment-settings.service';
import {
  PaymentAmountError,
  amountPaidFrom,
  clampPaymentAmount,
  dealPaymentStatus,
  isStripeBacked,
  refundableAmount,
  round2,
  statusAfterRefund,
  summarizePayments,
} from './payment-rules';
import { PaymentVersionConflictError, PaymentsRepository, type PaymentListFilter } from './payments.repository';
import { PaymentReportProjector } from './report/payment-report.projector';
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

/** The job's "Add payment": optionally an estimate's deposit (Workiz: the estimate's Deposits). */
export interface RecordJobPaymentInput extends RecordPaymentInput {
  estimateId?: string;
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

/**
 * The invoice + job a payment hangs off, after the caller's scope was checked.
 * `deal` is null for a CLIENT invoice (one with no job): the ledger is keyed
 * by the job today (`Payment.dealId`, the job board's payment flag, the
 * Payments report's job dimensions), so such an invoice can be read but not
 * yet paid — `recordOffline` answers 409 until the ledger learns about it.
 */
export interface PaymentContext {
  invoice: Invoice;
  deal: Pick<Deal, 'id' | 'assignedTechIds' | 'contactId' | 'serviceAreaId'> | null;
}

/** An invoice that has a job — the only kind the ledger can take a payment on today. */
export type JobInvoice = Invoice & { dealId: string };
const hasJob = (invoice: Invoice): invoice is JobInvoice => typeof invoice.dealId === 'string' && invoice.dealId !== '';

/**
 * The job a ledger hangs off, after the caller's scope was checked — with its
 * invoice when it has one. In Workiz a payment belongs to the JOB; an invoice
 * is a separate document, so `invoice` is legitimately `null` here.
 */
export interface JobContext {
  invoice: Invoice | null;
  view: DealBillingView;
}

/** Who a new payment row belongs to. `invoiceId` is always the job id. */
export interface PaymentOwner {
  invoiceId: string;
  dealId: string;
  contactId: string;
  companyId?: string;
  /** The job's lead technician and area at the time — the Payments report files the payment under them. */
  technicianId?: string;
  serviceAreaId?: string;
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
    @Optional() private readonly report?: PaymentReportProjector,
    @Optional() private readonly profiles?: BusinessProfileService,
    @Optional() private readonly estimates?: EstimatesService,
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
   * Sends the client their receipt. Billing never texts or emails anyone
   * itself — messaging owns client comms, and it is called on the CALLER's
   * bearer, exactly as the web app's "Send by text" dialog does.
   *
   * Where it goes (Workiz "Send a receipt?", whose Email field is editable):
   * no `channel` — today's rule, the client's first number, else their first
   * email; `channel` alone — the client's own address of that kind; `channel`
   * + `to` — the address typed on the phone. An email the client does not
   * have is taken onto their thread by messaging; a number they do not have
   * is texted on that number's own thread (messaging never adds a typed
   * number to the client's). The message names the job it is about, so
   * messaging checks an assigned technician against that job's roster.
   *
   * What it says (`receiptKind`): money collected gets the receipt for it; a
   * card attempt made on a staff phone that did not go through gets a
   * DECLINED receipt — Apple's Tap to Pay on iPhone rule 5.5.8 wants one sent
   * "regardless of outcome (approved or declined)". Anything else is a 409.
   */
  async sendReceipt(
    paymentId: string,
    caller: Caller,
    authorization?: string,
    request: PaymentReceiptRequest = {},
  ): Promise<PaymentReceiptResult> {
    const target = receiptTarget(request);
    const payment = await this.require(paymentId);
    const { invoice, view } = await this.paymentContext(payment, caller);
    const declined = receiptKind(payment) === 'declined';
    if (!this.messaging || !this.crm || !authorization) return { sent: false };

    const contact = await this.crm.getContact(payment.contactId).catch(() => null);
    const phones = contact?.phones ?? [];
    const emails = contact?.emails ?? [];
    const channel: 'sms' | 'email' = target.channel ?? (phones[0] ? 'sms' : 'email');
    const sentTo = target.to ?? (channel === 'sms' ? phones[0] : emails[0]);
    if (!sentTo) return { sent: false };

    // A job without an invoice (Workiz: payments belong to the job) is named by its number.
    const what = invoice ? `invoice ${invoice.number}` : `job ${view.deal.dealNumber}`;
    const body = declined
      ? declinedReceiptBody(payment, what)
      : receiptBody(
          payment,
          what,
          invoice ? invoice.totals?.balanceDue ?? 0 : await this.jobBalance(view, payment.invoiceId),
        );
    const job = UUID.test(payment.dealId) ? { dealId: payment.dealId } : {};

    if (channel === 'sms' && target.to && !phones.some((p) => tryNormalizePhone(p) === target.to)) {
      await this.messaging.sendToNumber({ phone: target.to, body, ...job }, authorization);
      return { sent: true, sentTo };
    }
    const subject =
      channel !== 'email'
        ? undefined
        : declined
          ? `Your payment with ${await this.businessName(view)} was declined`
          : target.channel
            ? `Your payment with ${await this.businessName(view)}`
            : `Payment receipt — ${what}`;
    await this.messaging.sendToContact(
      {
        contactId: payment.contactId,
        channel,
        body,
        ...(subject && { subject }),
        ...(target.to && { toAddress: target.to }),
        ...job,
      },
      authorization,
    );
    return { sent: true, sentTo };
  }

  /** The job's company — the one its documents render with — falling back to the default company. */
  private async businessName(view: DealBillingView): Promise<string> {
    const id = view.deal.businessProfileId ?? view.businessProfileId;
    const company = await this.profiles?.get(id).catch(() => null);
    return company?.name?.trim() || view.businessProfileName?.trim() || 'us';
  }

  // ------------------------------------------------------------ offline write

  /** Cash, a cheque, a card taken in person. Settled the moment it is recorded. */
  async recordOffline(invoiceId: string, input: RecordPaymentInput, caller: Caller): Promise<Payment> {
    const { invoice, deal } = await this.jobInvoiceFor(invoiceId, caller);
    assertOfflineMethod(input.method);
    return this.writeOffline(
      { ...invoiceOwner(invoice), ...jobDims(deal) },
      await this.amountDue(invoice),
      input,
      caller,
    );
  }

  /**
   * The job's "Add payment" (Workiz). With an invoice it is exactly
   * `recordOffline`; without one the payment still lands in the job's ledger
   * (invoice id === deal id) and the balance is the job's own total. With
   * `estimateId` it is that estimate's deposit — see `writeDeposit`.
   */
  async recordOfflineForDeal(dealId: string, input: RecordJobPaymentInput, caller: Caller): Promise<Payment> {
    const ctx = await this.jobContext(dealId, caller);
    assertOfflineMethod(input.method);
    const deal = ctx.view.deal;
    // The job's invoice (id === deal id) always has the job.
    const invoice = ctx.invoice && hasJob(ctx.invoice) ? ctx.invoice : null;
    const owner: PaymentOwner = invoice
      ? { ...invoiceOwner(invoice), ...jobDims(deal) }
      : {
          invoiceId: deal.id,
          dealId: deal.id,
          contactId: deal.contactId,
          ...(deal.companyId && { companyId: deal.companyId }),
          ...jobDims(deal),
        };
    if (input.estimateId !== undefined) return this.writeDeposit(input.estimateId, owner, input, caller);
    if (invoice) return this.writeOffline(owner, await this.amountDue(invoice), input, caller);
    const paid = amountPaidFrom(await this.repo.listByInvoice(deal.id));
    return this.writeOffline(owner, balanceOf(jobTotal(ctx.view, paid), paid), input, caller);
  }

  /**
   * A deposit taken by hand — cash, a cheque — for one of the job's estimates
   * (Workiz: "for payments like cash or check, you'll need to manually record
   * the payment" on the estimate's Deposits). It is stored as the portal's and
   * the phone's card deposits are: on the JOB's ledger, tagged with the
   * estimate — so the portal's deposit step, the estimate's deposit and the
   * job's balance all count it. The ceiling is what is still owed of the
   * deposit, as for a card deposit: not the job's balance, since the
   * estimate's work may not be on the job yet.
   */
  private async writeDeposit(
    estimateId: string,
    owner: PaymentOwner,
    input: RecordPaymentInput,
    caller: Caller,
  ): Promise<Payment> {
    const id = typeof estimateId === 'string' ? estimateId.trim() : '';
    const estimate = id ? await this.requireEstimates().getStored(id) : null;
    if (!estimate) throw new BadRequestException('That estimate was not found — the deposit cannot be recorded on it');
    if (!estimate.dealId) {
      throw new ConflictException('This estimate has no job to hold its deposit — copy it to a job first');
    }
    if (estimate.dealId !== owner.dealId) {
      throw new ConflictException('This estimate belongs to another job — record its deposit on that job');
    }
    if (estimate.contactId !== owner.contactId) {
      throw new ConflictException('This estimate belongs to another client — its deposit cannot be recorded here');
    }
    const depositDue = estimateDepositDue(estimate);
    if (!(depositDue > 0)) throw new BadRequestException('This estimate does not ask for a deposit');
    const paid = summarizePayments(
      (await this.repo.listByInvoice(owner.invoiceId)).filter((p) => p.estimateId === estimate.id),
    ).settled;
    return this.writeOffline(
      { ...owner, estimateId: estimate.id },
      round2(Math.max(0, depositDue - paid)),
      input,
      caller,
    );
  }

  private async writeOffline(
    owner: PaymentOwner & { estimateId?: string },
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

    this.tellChatOfPortalPayment(payment, opts, invoice?.number);

    // The Payments report re-derives this payment's lines from the ledger as
    // it now stands. Never throws — a lagging report is fixed by the next
    // write or by `rebuild:payment-report`.
    await this.report?.project(payment.id);
  }

  /**
   * Workiz writes "… submitted payment for invoice #…" into the client's chat
   * when they pay on the portal. Only the client's own portal payment, when
   * it lands (settled card) or is submitted (pending bank debit) — one line
   * per payment either way; never staff payments, failures, refunds or a
   * dispute won back. Fire-and-forget: the ledger never waits on the chat.
   */
  private tellChatOfPortalPayment(
    payment: Payment,
    opts: { event: BillingEventType; metadata?: Record<string, unknown> },
    invoiceNumber: string | undefined,
  ): void {
    if (!this.messaging || payment.source !== 'portal' || opts.metadata?.disputeId) return;
    if (opts.event !== BillingEventType.PAYMENT_SUCCEEDED && opts.event !== BillingEventType.PAYMENT_PENDING) return;
    const messaging = this.messaging;
    void (async () => {
      const deposit = payment.estimateId ? await this.estimates?.getStored(payment.estimateId) : undefined;
      const document = deposit
        ? { kind: 'estimate' as const, id: deposit.id, number: deposit.number }
        : invoiceNumber
          ? { kind: 'invoice' as const, id: payment.invoiceId, number: invoiceNumber }
          : null;
      if (!document) return;
      await messaging.recordPortalEvent({
        contactId: payment.contactId,
        event: 'payment',
        document,
        dealId: payment.dealId,
        amount: payment.amount,
        eventKey: `payment:${payment.id}`,
      });
    })().catch((err: Error) => this.logger.warn(`portal payment ${payment.id} not in the chat: ${err.message}`));
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

  /**
   * A JOB invoice money can be taken on, with the caller's scope checked:
   * 404 without the invoice (or its job), 403 off the job's roster, 409 for a
   * client invoice — the ledger is keyed by the job. The offline record and
   * the Terminal intent both start here.
   */
  async jobInvoiceFor(
    invoiceId: string,
    caller: Caller,
  ): Promise<{ invoice: JobInvoice; deal: NonNullable<PaymentContext['deal']> }> {
    const { invoice, deal } = await this.context(invoiceId, caller);
    if (!deal || !hasJob(invoice)) {
      throw new ConflictException(
        'This invoice belongs to the client and has no job — payments can only be recorded on a job’s invoice for now',
      );
    }
    return { invoice, deal };
  }

  /** The invoice + its job, with the caller's `assigned_only` scope enforced. */
  private async context(invoiceId: string, caller: Caller): Promise<PaymentContext> {
    const invoice = await this.invoices.getStored(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!hasJob(invoice)) {
      // A client invoice (no job) is the office's alone — there is no job to be assigned to.
      if (isAssignedOnly(caller, 'payments')) {
        throw new ForbiddenException('This invoice belongs to the client and has no job you are assigned to');
      }
      return { invoice, deal: null };
    }
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
  async paymentContext(payment: Payment, caller: Caller): Promise<JobContext> {
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
    return clampStaffAmount(requested, amountDue);
  }

  private requireEstimates(): EstimatesService {
    if (!this.estimates) throw new Error('EstimatesService not wired');
    return this.estimates;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The receipt request, checked here as well as by the DTO (the service is
 * called directly, too): an email for `email`, an E.164 number for `sms`, and
 * `to` only with a `channel` — 400 otherwise. The email is lower-cased, as
 * messaging keeps it.
 */
function receiptTarget(request: PaymentReceiptRequest | undefined): PaymentReceiptRequest {
  const channel = request?.channel;
  const to = request?.to;
  if (channel !== undefined && channel !== 'email' && channel !== 'sms') {
    throw new BadRequestException('channel must be email or sms');
  }
  if (to === undefined || to === null) return channel ? { channel } : {};
  if (!channel) throw new BadRequestException('Say how to send the receipt: channel email or sms');
  const value = typeof to === 'string' ? to.trim() : '';
  if (channel === 'email') {
    if (!isEmail(value)) throw new BadRequestException('That is not an email address');
    return { channel, to: value.toLowerCase() };
  }
  if (!RECEIPT_E164.test(value)) {
    throw new BadRequestException('A receipt is texted to an E.164 number, like +18605550100');
  }
  return { channel, to: value };
}

/** The receipt's text: what was received, what the card paid in all (tip, service fee), and what is still owed. */
function receiptBody(payment: Payment, what: string, balanceDue: number): string {
  const tip = payment.tipAmount ?? 0;
  const fee = payment.feeAmount ?? 0;
  const extras = [tip > 0 && `a $${tip.toFixed(2)} tip`, fee > 0 && `a $${fee.toFixed(2)} service fee`].filter(
    (e): e is string => !!e,
  );
  const inAll = extras.length
    ? `, plus ${extras.join(' and ')} — $${round2(payment.amount + tip + fee).toFixed(2)} in all.`
    : '.';
  const refunded = (payment.refundedAmount ?? 0) > 0;
  return (
    `Receipt for ${what}: $${payment.amount.toFixed(2)} received ` +
    `(${payment.method}) on ${payment.takenAt.slice(0, 10)}${inAll}` +
    (refunded ? ` $${(payment.refundedAmount ?? 0).toFixed(2)} of it has been refunded.` : '') +
    ` Balance due: $${balanceDue.toFixed(2)}.`
  );
}

/**
 * Which receipt a payment has, or a 409 when it has none:
 *  - `paid` — the money was collected (`settled`, or `refunded` since).
 *  - `declined` — a card attempt made on a staff phone, tapped (`terminal`)
 *    or typed (`keyed`), that did not go through: declined, cancelled on the
 *    device, replaced, given up on. Stripe has its intent and nothing was
 *    taken. Apple's Tap to Pay on iPhone rule 5.5.8: a receipt "regardless of
 *    outcome (approved or declined)".
 * A typed card Stripe never answered has no intent on its row: the card MAY
 * have been charged (its retry asks Stripe again), so no receipt may say it
 * was not. Money still in flight (`pending`), a failed portal checkout or
 * offline row, a reversal: nothing to receipt.
 */
function receiptKind(payment: Payment): 'paid' | 'declined' {
  if (payment.status === 'settled' || payment.status === 'refunded') return 'paid';
  if (payment.status === 'failed' && (payment.channel === 'terminal' || payment.channel === 'keyed')) {
    if (payment.stripePaymentIntentId) return 'declined';
    throw new ConflictException(
      'Stripe has not said whether this card was charged — try the payment again before sending a receipt',
    );
  }
  throw new ConflictException('There is no receipt to send until the payment has been collected');
}

/**
 * A declined card's receipt: what the card was asked for (the tip and the
 * service fee included — the total the client saw), the card and Stripe's
 * reason when the row has them, and that nothing was taken.
 */
function declinedReceiptBody(payment: Payment, what: string): string {
  const asked = round2(payment.amount + (payment.tipAmount ?? 0) + (payment.feeAmount ?? 0));
  const card = cardLabel(payment);
  const reason = asSentence(payment.failureReason);
  return (
    `Payment declined: $${asked.toFixed(2)} for ${what} on ${payment.takenAt.slice(0, 10)}` +
    (card ? ` (${card})` : '') +
    '. No money was taken.' +
    (reason ? ` Reason: ${reason}` : '')
  );
}

/** Stripe's `card.brand` / `card_present.brand`, as a client reads it (any other is shown as Stripe sent it). */
const CARD_BRANDS: ReadonlyMap<string, string> = new Map([
  ['amex', 'American Express'],
  ['diners', 'Diners Club'],
  ['discover', 'Discover'],
  ['interac', 'Interac'],
  ['jcb', 'JCB'],
  ['mastercard', 'Mastercard'],
  ['unionpay', 'UnionPay'],
  ['visa', 'Visa'],
]);

/** "Visa ending in 4242", "Visa", "card ending in 4242" — or nothing when Stripe named no card. */
function cardLabel(payment: Pick<Payment, 'cardBrand' | 'last4'>): string | undefined {
  const raw = payment.cardBrand?.trim();
  const brand = raw && raw !== 'unknown' ? CARD_BRANDS.get(raw) ?? raw : undefined;
  const last4 = payment.last4?.trim();
  if (!last4) return brand;
  return `${brand ?? 'card'} ending in ${last4}`;
}

/** Stripe's message as a sentence ("Cancelled on the device" → "Cancelled on the device."). */
function asSentence(text: string | undefined): string | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

/**
 * What staff may take against `amountDue` — the record-payment rule, shared
 * with the Terminal routes: a part payment is fine, more than is owed is a
 * 400 (refused, never quietly capped), and so is anything when nothing is owed.
 */
export function clampStaffAmount(requested: unknown, amountDue: number): number {
  try {
    return clampPaymentAmount({ requested, amountDue, allowPartial: true, method: 'card', bankMinimum: 0 });
  } catch (err) {
    if (err instanceof PaymentAmountError) throw new BadRequestException(err.message);
    throw err;
  }
}

/** Who led the job and where, as the report files a payment (only what the job has). */
export const jobDims = (
  deal: Pick<Deal, 'assignedTechIds' | 'serviceAreaId'>,
): Pick<PaymentOwner, 'technicianId' | 'serviceAreaId'> => ({
  ...(deal.assignedTechIds?.[0] && { technicianId: deal.assignedTechIds[0] }),
  ...(deal.serviceAreaId && { serviceAreaId: deal.serviceAreaId }),
});

const invoiceOwner = (invoice: JobInvoice): PaymentOwner => ({
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

export { isStripeBacked };

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
