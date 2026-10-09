import { RedisService, cachedCount, countCacheKey } from '@bitcrm/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  BillingEventType,
  PaymentTerms,
  TimelineEventType,
  effectiveTaxRatePercent,
  lineAmount,
  type BillingLine,
  type DocumentDiscount,
  type DocumentTotals,
  type Invoice,
  type InvoiceItem,
  type InvoiceStatus,
  type InvoiceView,
  type ListCount,
  type OnlinePaymentMethod,
  type Payment,
  type PaymentSummary,
  type ProductType,
  type DocumentVisibility,
} from '@bitcrm/types';
import { assertDealAccess, isAssignedOnly, type Caller } from '../common/access';
import { isYmd, resolveTimezone, todayIn } from '../common/dates';
import { standaloneDocumentNumber } from '../common/document-number';
import { BusinessProfileService } from '../business-profile/business-profile.service';
import { DocumentSettingsService } from '../documents/document-settings.service';
import { DocumentsService } from '../documents/documents.service';
import { SignaturesService } from '../signatures/signatures.service';
import { displayOverrides, reorderPositions, sortItems } from '../estimates/estimate-rules';
import { BillingEventsPublisher } from '../integrations/billing-events.publisher';
import { CrmClient } from '../integrations/crm.client';
import { DealClient, type DealBillingView } from '../integrations/deal.client';
import { NumberingService } from '../numbering/numbering.service';
import {
  computeClientInvoiceTotals,
  computeDueDate,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  dueDateBasisDate,
  resolvePaymentTerms,
  termDays,
} from './invoice-rules';
import { amountPaidFrom, summarizePayments } from '../payments/payment-rules';
import { PaymentsRepository } from '../payments/payments.repository';
import {
  InvoiceExistsError,
  InvoiceVersionConflictError,
  InvoicesRepository,
  type InvoiceListFilter,
} from './invoices.repository';
import { UnpaidInvoicesRepository } from './unpaid-invoices.repository';

/** A signature from the portal canvas (or the technician's phone). */
export interface SignInvoiceInput {
  imageDataUrl: string;
  signedBy: string;
  ip?: string;
}

export interface UpdateInvoiceInput {
  invoiceDate?: string;
  paymentTerms?: PaymentTerms;
  dueDate?: string;
  notes?: string | null;
  templateId?: string | null;
  /** Workiz Send panel "Request signature": the portal asks the client to sign before paying. */
  requestSignature?: boolean;
  /** Workiz Send panel "Advanced": which details the client sees; `null` = the template's own. */
  display?: Partial<DocumentVisibility> | null;
  /** CLIENT invoices only — a job invoice's tax and discount are the job's (422 otherwise). */
  taxRateId?: string | null;
  discount?: DocumentDiscount | null;
}

/** A line of a CLIENT invoice (a job invoice's lines are the job's items). */
export interface InvoiceItemInput {
  productId: string;
  productType?: ProductType;
  name: string;
  sku: string;
  description?: string;
  quantity: number;
  priceClient: number;
  costCompany: number;
  costForTech: number;
  taxable?: boolean;
}

export interface InvoiceSummary {
  dueAmount: number;
  dueCount: number;
  overdueAmount: number;
  overdueCount: number;
  unsentCount: number;
  paidAmount: number;
  paidCount: number;
  needsInvoiceCount: number;
  /** Clients with any open balance (due or overdue) — Workiz's "Due from N clients". */
  dueClientCount: number;
  /** Clients with an overdue balance — Workiz's "Past due from N clients". */
  overdueClientCount: number;
}

/** `GET /invoices/balances` — the open balances and how many clients owe them. */
export type InvoiceBalances = Pick<
  InvoiceSummary,
  'dueAmount' | 'dueCount' | 'overdueAmount' | 'overdueCount' | 'dueClientCount' | 'overdueClientCount'
>;

export interface NeedingInvoiceRow {
  id: string;
  dealNumber: string;
  contactId: string;
  clientName?: string;
  itemCount: number;
  total: number;
  createdAt: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The payment ledger, as the invoice needs it. Injected as the repository (not
 * PaymentsService) so the dependency runs one way and there is no module cycle.
 */
export interface PaymentLedgerSource {
  listByInvoice(invoiceId: string): Promise<Payment[]>;
}

/**
 * Totals/status/contact are derived from the job. Writing them must not bump
 * `version`, or a deal event landing between a user's read and write turns
 * that user's edit (mark-sent, terms…) into a spurious 409.
 */
const SNAPSHOT_WRITE = { bumpVersion: false } as const;

function toBillingLines(view: DealBillingView): BillingLine[] {
  return view.items.map((i) => ({
    lineId: i.productId,
    productId: i.productId,
    name: i.name,
    sku: i.sku,
    ...(i.description && { description: i.description }),
    quantity: i.quantity,
    priceClient: i.priceClient,
    costCompany: i.costCompany,
    costForTech: i.costForTech,
    taxable: i.taxable !== false,
    amount: lineAmount(i),
  }));
}

/** A client invoice's own rows, in order, as the lines a screen or PDF prints. */
function ownLines(items: InvoiceItem[]): BillingLine[] {
  return sortItems(items).map((i) => ({
    lineId: i.lineId,
    position: i.position,
    productId: i.productId,
    ...(i.productType && { productType: i.productType }),
    name: i.name,
    sku: i.sku,
    ...(i.description && { description: i.description }),
    quantity: i.quantity,
    priceClient: i.priceClient,
    costCompany: i.costCompany,
    costForTech: i.costForTech,
    taxable: i.taxable !== false,
    amount: lineAmount(i),
  }));
}

/** Key-order-insensitive: DynamoDB does not preserve the order of a map's keys. */
const sameTotals = (a: DocumentTotals | undefined, b: DocumentTotals) => !!a && isDeepStrictEqual({ ...a }, { ...b });

/** Under `assigned_only`: the invoice's job is one of mine. No job ⇒ never mine. */
const onMyJobs = (i: Pick<Invoice, 'dealId'>, mine: Set<string>): boolean => !!i.dealId && mine.has(i.dealId);

/** Narrows an invoice to one that has a job. */
type JobInvoice = Invoice & { dealId: string };
const hasJob = (invoice: Invoice): invoice is JobInvoice => typeof invoice.dealId === 'string' && invoice.dealId !== '';

/**
 * Invoices (Workiz): either a job's or a client's.
 *
 * - Job invoice: one per job, id + number are the job's, and the items / tax /
 *   discount ARE the job's — the invoice stores only its own fields plus a
 *   totals + status snapshot for lists.
 * - Client invoice (the client card's Create new → Invoice): no job. It owns
 *   its lines and tax/discount, is numbered from the account counter, takes
 *   its due date from the client's payment terms and is office-only (a
 *   technician's `assigned_only` scope is about jobs). Nothing is read from or
 *   written to deal-service for it.
 */
/** How long a list count stays good enough. Matches the deals tab counts. */
const COUNT_TTL_SECONDS = 30;

/** How many of one client's documents the portal reads to build its inbox. */
const CONTACT_DOCUMENTS_CAP = 1000;

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly repo: InvoicesRepository,
    private readonly deal: DealClient,
    private readonly crm: CrmClient,
    private readonly profiles: BusinessProfileService,
    @Optional() private readonly documents?: DocumentsService,
    @Optional() private readonly events?: BillingEventsPublisher,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(PaymentsRepository) private readonly ledger?: PaymentLedgerSource,
    @Optional() private readonly unpaid?: UnpaidInvoicesRepository,
    @Optional() private readonly documentSettings?: DocumentSettingsService,
    @Optional() private readonly signatures?: SignaturesService,
    @Optional() private readonly numbering?: NumberingService,
  ) {}

  /**
   * A client invoice's number: Settings → Numbering's invoice counter. The
   * legacy shared counter only when the numbering service is not wired (a
   * unit test built with `new`); the module always provides it.
   */
  private async standaloneNumber(): Promise<string> {
    if (this.numbering) return this.numbering.nextNumber('invoice');
    return standaloneDocumentNumber(await this.repo.nextAccountSeq());
  }

  // ---------------------------------------------------------------- create

  /** The default Notes of a NEW invoice (Workiz: Settings → Documents). Best effort. */
  private async newInvoiceDefaults(): Promise<Pick<Invoice, 'notes'>> {
    if (!this.documentSettings) return {};
    try {
      const notes = (await this.documentSettings.get()).invoiceNotes?.trim();
      return notes ? { notes } : {};
    } catch (err) {
      this.logger.warn(`document settings unavailable, creating a blank invoice: ${(err as Error).message}`);
      return {};
    }
  }

  async create(dealId: string, caller: Caller): Promise<InvoiceView> {
    const view = await this.loadView(dealId);
    assertDealAccess(caller, 'invoices', view.deal);
    if (view.items.length === 0) {
      throw new UnprocessableEntityException('Add at least one item to the job before creating its invoice');
    }

    const deal = view.deal;
    const [profile, contact, company, tz] = await Promise.all([
      // Default terms / due basis come from the job's company (client terms still win).
      this.profiles.get(deal.businessProfileId),
      this.crm.getContact(deal.contactId).catch(() => null),
      deal.companyId ? this.crm.getCompany(deal.companyId).catch(() => null) : Promise.resolve(null),
      this.timezoneFor(deal.serviceAreaId),
    ]);

    const now = new Date().toISOString();
    const invoiceDate = todayIn(tz);
    const { terms } = resolvePaymentTerms(contact, company as never, profile);
    const days = this.daysFor(terms, company as { customTermsDays?: number } | null, profile.defaultCustomTermDays, contact);
    const dueDate = computeDueDate(dueDateBasisDate(profile, { invoiceDate, deal, timezone: tz }), days);
    const amountPaid = await this.ledgerAmountPaid(deal.id);
    const totals = computeInvoiceTotals(view, { amountPaid });

    const invoice: Invoice = {
      id: deal.id,
      number: deal.dealNumber,
      dealId: deal.id,
      contactId: deal.contactId,
      ...(deal.companyId && { companyId: deal.companyId }),
      invoiceDate,
      paymentTerms: terms,
      dueDate,
      ...(await this.newInvoiceDefaults()),
      status: deriveInvoiceStatus({
        totals,
        dueDate,
        today: invoiceDate,
        ...(amountPaid === undefined && { paymentStatus: deal.paymentStatus }),
      }),
      totals,
      version: 1,
      createdBy: caller.user.id,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.repo.create(invoice);
    } catch (err) {
      if (err instanceof InvoiceExistsError) throw new ConflictException('This job already has an invoice');
      throw err;
    }

    try {
      await this.deal.setInvoiceLink(deal.id, invoice.id);
    } catch (err) {
      // Without the link the job keeps showing as "needs invoice" — undo.
      await this.repo.delete(invoice.id).catch(() => undefined);
      throw err;
    }

    await this.deal.addTimeline(deal.id, TimelineEventType.INVOICE_CREATED, caller.user.id, {
      invoiceId: invoice.id,
      number: invoice.number,
      total: totals.total,
    }, caller.user.email);
    this.events?.invoice(BillingEventType.INVOICE_CREATED, invoice);
    return this.toView(invoice, view);
  }

  /**
   * A client's invoice with no job (Workiz: the client card's Create new →
   * Invoice): a fresh id, a stub number from the account counter, Bill to =
   * the client, the due date from the CLIENT's payment terms (then the
   * company's, then the default profile's), tax exempt when the client is,
   * and no lines yet. Office-only.
   */
  async createForClient(contactId: string, caller: Caller): Promise<InvoiceView> {
    if (isAssignedOnly(caller, 'invoices')) {
      throw new ForbiddenException('An invoice without a job can only be created from the office');
    }
    const contact = await this.crm.getContact(contactId);
    if (!contact) throw new NotFoundException('Client not found');
    const [company, profile, number] = await Promise.all([
      contact.companyId ? this.crm.getCompany(contact.companyId).catch(() => null) : Promise.resolve(null),
      this.profiles.get(undefined),
      this.standaloneNumber(),
    ]);

    const now = new Date().toISOString();
    const invoiceDate = todayIn(resolveTimezone(undefined));
    const { terms } = resolvePaymentTerms(contact, company as never, profile);
    const days = this.daysFor(terms, company as { customTermsDays?: number } | null, profile.defaultCustomTermDays, contact);
    // No job to count from: the terms run from the invoice date.
    const dueDate = computeDueDate(invoiceDate, days);

    const base: Invoice = {
      id: randomUUID(),
      number,
      contactId: contact.id,
      ...(contact.companyId && { companyId: contact.companyId }),
      ...(contact.taxExempt && { taxRatePercent: 0, taxSource: 'exempt' as const }),
      invoiceDate,
      paymentTerms: terms,
      dueDate,
      ...(await this.newInvoiceDefaults()),
      status: 'no_amount',
      totals: computeClientInvoiceTotals({}, [], { amountPaid: 0 }),
      version: 1,
      createdBy: caller.user.id,
      createdAt: now,
      updatedAt: now,
    };
    const totals = computeClientInvoiceTotals(base, [], { amountPaid: 0 });
    const invoice: Invoice = { ...base, totals, status: deriveInvoiceStatus({ totals, dueDate, today: invoiceDate }) };

    await this.repo.create(invoice);
    this.events?.invoice(BillingEventType.INVOICE_CREATED, invoice);
    return this.toClientView(invoice, []);
  }

  // ------------------------------------------------------------------ read

  async get(id: string, caller: Caller): Promise<InvoiceView> {
    const invoice = await this.require(id);
    const base = hasJob(invoice) ? await this.jobView(invoice, caller) : await this.clientView(invoice, caller);
    return { ...base, ...(await this.signaturesOf(id)) };
  }

  private async jobView(invoice: Invoice & { dealId: string }, caller: Caller): Promise<InvoiceView> {
    const view = await this.loadView(invoice.dealId);
    assertDealAccess(caller, 'invoices', view.deal);
    const fresh = await this.refreshSnapshot(invoice, view);
    return this.toView(fresh, view, await this.ledgerFor(invoice.id));
  }

  /** The document's signatures, oldest first — absent when signatures are not wired. */
  private async signaturesOf(id: string): Promise<Pick<InvoiceView, 'signatures'>> {
    if (!this.signatures) return {};
    return { signatures: await this.signatures.list('invoice', id) };
  }

  // ------------------------------------------------------------ signatures

  /**
   * The client signs a SENT invoice on the portal (Workiz "Request
   * signature"): taken before the payment, kept as evidence on the document.
   */
  async signByClient(id: string, input: SignInvoiceInput): Promise<InvoiceView> {
    const invoice = await this.require(id);
    if (!invoice.sentAt) throw new UnprocessableEntityException('This invoice has not been sent');
    const signatures = this.requireSignatures();
    const signature = await signatures.collect({
      kind: 'invoice',
      documentId: id,
      ...(invoice.dealId && { dealId: invoice.dealId }),
      contactId: invoice.contactId,
      imageDataUrl: input.imageDataUrl,
      signedBy: input.signedBy,
      source: 'portal',
      ...(input.ip && { ip: input.ip }),
    });
    const signed = await this.stampSigned(invoice, signature.signedAt);
    if (hasJob(signed)) {
      await this.deal.addTimeline(
        signed.dealId,
        TimelineEventType.INVOICE_SIGNED,
        'client',
        { invoiceId: id, number: signed.number, signedBy: signature.signedBy, signatureId: signature.id },
        signature.signedBy,
      );
    }
    const base = hasJob(signed)
      ? this.toView(signed, await this.loadView(signed.dealId), await this.ledgerFor(id))
      : this.toClientView(signed, await this.repo.getItems(id), await this.ledgerFor(id));
    return { ...base, signatures: await signatures.list('invoice', id) };
  }

  /** A signature collected in person by staff (the technician's phone). */
  async sign(id: string, input: SignInvoiceInput, caller: Caller): Promise<InvoiceView> {
    const invoice = await this.require(id);
    const view = await this.accessView(invoice, caller);
    const signatures = this.requireSignatures();
    const signature = await signatures.collect({
      kind: 'invoice',
      documentId: id,
      ...(invoice.dealId && { dealId: invoice.dealId }),
      contactId: invoice.contactId,
      imageDataUrl: input.imageDataUrl,
      signedBy: input.signedBy,
      source: 'app',
      collectedBy: caller.user.id,
      ...(input.ip && { ip: input.ip }),
    });
    const signed = await this.stampSigned(invoice, signature.signedAt);
    if (hasJob(signed)) {
      await this.deal.addTimeline(
        signed.dealId,
        TimelineEventType.INVOICE_SIGNED,
        caller.user.id,
        { invoiceId: id, number: signed.number, signedBy: signature.signedBy, signatureId: signature.id },
        caller.user.email,
      );
    }
    const base = view
      ? this.toView(signed, view, await this.ledgerFor(id))
      : this.toClientView(signed, await this.repo.getItems(id), await this.ledgerFor(id));
    return { ...base, signatures: await signatures.list('invoice', id) };
  }

  /** `signedAt` on the invoice row, so lists and the portal know without reading the signatures. */
  private stampSigned(invoice: Invoice, signedAt: string): Promise<Invoice> {
    return this.repo.update(invoice.id, { signedAt, updatedAt: signedAt }, [], undefined, SNAPSHOT_WRITE);
  }

  private requireSignatures(): SignaturesService {
    if (!this.signatures) throw new UnprocessableEntityException('Signatures are not available');
    return this.signatures;
  }

  async getByDeal(dealId: string, caller: Caller): Promise<InvoiceView | null> {
    const invoice = await this.repo.get(dealId);
    if (!invoice) return null;
    return this.get(invoice.id, caller);
  }

  /** Stored row, no access check — for the portal and internal reads. */
  getStored(id: string): Promise<Invoice | null> {
    return this.repo.get(id);
  }

  /**
   * Every invoice of the client, newest first, as plain rows (no items) —
   * what the portal sorts and pages its inbox from. Capped at 1000: the
   * portal looks per-document things up only for the page it shows, so the
   * old 200 that cut a big client's oldest documents off is no longer needed.
   */
  listForContact(contactId: string): Promise<Invoice[]> {
    return this.repo.list({ contactId, limit: CONTACT_DOCUMENTS_CAP }).then((r) => r.items);
  }

  async list(
    query: Omit<InvoiceListFilter, 'limit'> & { limit?: number; dealId?: string },
    caller: Caller,
  ): Promise<{ items: Invoice[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    let result: { items: Invoice[]; nextCursor?: string };
    if (query.dealId) {
      const one = await this.repo.get(query.dealId);
      result = { items: one && (!query.status || one.status === query.status) ? [one] : [] };
    } else {
      result = await this.repo.list({ ...query, limit });
    }
    if (isAssignedOnly(caller, 'invoices')) {
      // Page-local filter: a technician's page can come back short. Their
      // job list is capped at 100 by deal-service (`internal/by-tech`). A
      // client invoice has no job to be assigned to, so they never see one.
      const mine = await this.deal.listDealIdsByTech(caller.user.id);
      result = { ...result, items: result.items.filter((i) => onMyJobs(i, mine)) };
    }
    return result;
  }

  /**
   * How many invoices the filter selects — the number behind "Page 2 of 7".
   *
   * A technician scoped to their own jobs gets `null`, not a number: their
   * page is filtered after the query, so no index walk can answer it, and a
   * count of everyone's invoices would be a lie on their screen. The panel
   * then shows "Page 2" and drops the "of N".
   */
  async count(
    query: Omit<InvoiceListFilter, 'limit'> & { dealId?: string },
    caller: Caller,
  ): Promise<ListCount> {
    if (isAssignedOnly(caller, 'invoices')) return { total: null, atLeast: false };

    // One invoice per job: asking about a job is asking whether it has one.
    if (query.dealId) {
      const one = await this.repo.get(query.dealId);
      const matches = one && (!query.status || one.status === query.status);
      return { total: matches ? 1 : 0, atLeast: false };
    }

    const take = () => this.repo.count({ ...query, limit: 1 } as InvoiceListFilter);
    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('invoices', {
        contactId: query.contactId,
        status: query.status,
        from: query.from,
        to: query.to,
        unsent: query.unsent,
      }),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  async summary(caller: Caller, authorization?: string): Promise<InvoiceSummary> {
    const all = await this.visible(await this.repo.listAll(), caller);
    const s: InvoiceSummary = {
      dueAmount: 0,
      dueCount: 0,
      overdueAmount: 0,
      overdueCount: 0,
      unsentCount: 0,
      paidAmount: 0,
      paidCount: 0,
      needsInvoiceCount: 0,
      dueClientCount: 0,
      overdueClientCount: 0,
    };
    const owing = new Set<string>();
    const pastDue = new Set<string>();
    for (const inv of all) {
      const balance = inv.totals?.balanceDue ?? 0;
      if (inv.status === 'due') {
        s.dueCount++;
        s.dueAmount += balance;
        owing.add(inv.contactId);
      } else if (inv.status === 'overdue') {
        s.overdueCount++;
        s.overdueAmount += balance;
        owing.add(inv.contactId);
        pastDue.add(inv.contactId);
      } else if (inv.status === 'paid') {
        s.paidCount++;
        s.paidAmount += inv.totals?.amountPaid ?? inv.totals?.total ?? 0;
      }
      if (!inv.sentAt) s.unsentCount++;
    }
    s.dueClientCount = owing.size;
    s.overdueClientCount = pastDue.size;
    s.dueAmount = round2(s.dueAmount);
    s.overdueAmount = round2(s.overdueAmount);
    s.paidAmount = round2(s.paidAmount);
    s.needsInvoiceCount = (await this.needingInvoice(authorization)).length;
    return s;
  }

  /**
   * The open balances only — Workiz's Clients page cards ("Due from 335
   * clients", "Past due from 260 clients"): what is owed on `due` and
   * `overdue` invoices and how many clients owe it. Read off UnpaidIndex
   * (~600 rows; the full list's open invoices until it is backfilled), never
   * the whole ledger and never the deal service — the summary's
   * jobs-needing-an-invoice walk is what made it two seconds.
   */
  async balances(caller: Caller): Promise<InvoiceBalances> {
    const open = this.unpaid
      ? (await this.unpaid.listUnpaid()).items
      : (await this.repo.listAll()).filter((i) => i.status === 'due' || i.status === 'overdue');
    const b: InvoiceBalances = {
      dueAmount: 0,
      dueCount: 0,
      overdueAmount: 0,
      overdueCount: 0,
      dueClientCount: 0,
      overdueClientCount: 0,
    };
    const owing = new Set<string>();
    const pastDue = new Set<string>();
    for (const inv of await this.visible(open, caller)) {
      const balance = inv.totals?.balanceDue ?? 0;
      if (inv.status === 'due') {
        b.dueCount++;
        b.dueAmount += balance;
        owing.add(inv.contactId);
      } else if (inv.status === 'overdue') {
        b.overdueCount++;
        b.overdueAmount += balance;
        owing.add(inv.contactId);
        pastDue.add(inv.contactId);
      }
    }
    b.dueAmount = round2(b.dueAmount);
    b.overdueAmount = round2(b.overdueAmount);
    b.dueClientCount = owing.size;
    b.overdueClientCount = pastDue.size;
    return b;
  }

  /** Jobs with items and no invoice (the caller's `deals` scope applies). */
  async needingInvoice(authorization?: string): Promise<NeedingInvoiceRow[]> {
    const deals = await this.deal.listNeedsInvoice(authorization).catch((err: Error) => {
      this.logger.warn(`needs-invoice list unavailable: ${err.message}`);
      return [];
    });
    return deals
      .filter((d) => (d.itemCount ?? 0) > 0)
      .map((d) => ({
        id: d.id,
        dealNumber: d.dealNumber,
        contactId: d.contactId,
        ...(d.clientName && { clientName: `${d.clientName.firstName} ${d.clientName.lastName}`.trim() }),
        itemCount: d.itemCount ?? 0,
        total: d.actualTotal ?? d.estimatedTotal ?? 0,
        createdAt: d.createdAt,
      }));
  }

  // ----------------------------------------------------------------- write

  async update(id: string, input: UpdateInvoiceInput, caller: Caller): Promise<InvoiceView> {
    const invoice = await this.require(id);
    if (input.invoiceDate !== undefined && !isYmd(input.invoiceDate)) {
      throw new BadRequestException('invoiceDate must be YYYY-MM-DD');
    }
    if (input.dueDate !== undefined && !isYmd(input.dueDate)) {
      throw new BadRequestException('dueDate must be YYYY-MM-DD');
    }
    if (!hasJob(invoice)) return this.updateClient(invoice, input, caller);
    if (input.taxRateId !== undefined || input.discount !== undefined) {
      throw new UnprocessableEntityException(
        "This invoice is the job's — its tax rate and discount are edited on the job's items",
      );
    }

    const view = await this.loadView(invoice.dealId);
    assertDealAccess(caller, 'invoices', view.deal);

    const set: Partial<Invoice> & Record<string, unknown> = { updatedAt: new Date().toISOString() };
    const remove: string[] = [];
    this.applyHeader(set, remove, input);

    if (input.dueDate !== undefined) {
      set.dueDate = input.dueDate;
    } else if (input.paymentTerms !== undefined || input.invoiceDate !== undefined) {
      const [profile, tz] = await Promise.all([
        this.profiles.get(view.deal.businessProfileId),
        this.timezoneFor(view.deal.serviceAreaId),
      ]);
      const terms = input.paymentTerms ?? invoice.paymentTerms;
      const days = this.termDaysFor(terms, invoice, profile.defaultCustomTermDays);
      const basis = dueDateBasisDate(profile, {
        invoiceDate: (set.invoiceDate as string | undefined) ?? invoice.invoiceDate,
        deal: view.deal,
        timezone: tz,
      });
      set.dueDate = computeDueDate(basis, days);
    }

    const amountPaid = await this.ledgerAmountPaid(invoice.id);
    const totals = computeInvoiceTotals(view, { amountPaid });
    const tz = await this.timezoneFor(view.deal.serviceAreaId);
    set.totals = totals;
    set.status = deriveInvoiceStatus({
      totals,
      dueDate: (set.dueDate as string | undefined) ?? invoice.dueDate,
      today: todayIn(tz),
      ...(amountPaid === undefined && { paymentStatus: view.deal.paymentStatus }),
    });

    const updated = await this.writeWithConflict(id, set, remove, invoice.version);
    await this.deal.addTimeline(invoice.dealId, TimelineEventType.INVOICE_UPDATED, caller.user.id, {
      invoiceId: id,
      fields: Object.keys(input),
    }, caller.user.email);
    this.events?.invoice(BillingEventType.INVOICE_UPDATED, updated);
    return this.toView(updated, view);
  }

  /** A client invoice's header, terms, tax rate and discount — all its own. */
  private async updateClient(invoice: Invoice, input: UpdateInvoiceInput, caller: Caller): Promise<InvoiceView> {
    this.assertOffice(caller);
    const set: Partial<Invoice> & Record<string, unknown> = { updatedAt: new Date().toISOString() };
    const remove: string[] = [];
    this.applyHeader(set, remove, input);

    if (input.dueDate !== undefined) {
      set.dueDate = input.dueDate;
    } else if (input.paymentTerms !== undefined || input.invoiceDate !== undefined) {
      const profile = await this.profiles.get(undefined);
      const terms = input.paymentTerms ?? invoice.paymentTerms;
      const days = this.termDaysFor(terms, invoice, profile.defaultCustomTermDays);
      set.dueDate = computeDueDate((set.invoiceDate as string | undefined) ?? invoice.invoiceDate, days);
    }

    if (input.taxRateId !== undefined) {
      if (input.taxRateId === null) {
        remove.push('taxRateId', 'taxRateName');
        set.taxRatePercent = 0;
        set.taxSource = 'manual';
      } else {
        const rates = await this.deal.listTaxRates();
        const rate = rates.find((r) => r.id === input.taxRateId);
        if (!rate) throw new NotFoundException('Tax rate not found');
        set.taxRateId = rate.id;
        set.taxRateName = rate.name;
        set.taxRatePercent = effectiveTaxRatePercent(rate, rates);
        set.taxSource = 'manual';
      }
    }
    if (input.discount !== undefined) {
      if (input.discount === null || !(input.discount.value > 0)) remove.push('discount');
      else set.discount = { type: input.discount.type, value: input.discount.value };
    }

    const next = { ...invoice, ...set } as Invoice;
    for (const k of remove) delete (next as unknown as Record<string, unknown>)[k];
    const items = await this.repo.getItems(invoice.id);
    const amountPaid = (await this.ledgerAmountPaid(invoice.id)) ?? 0;
    set.totals = computeClientInvoiceTotals(next, items, { amountPaid });
    set.status = deriveInvoiceStatus({
      totals: set.totals,
      dueDate: next.dueDate,
      today: todayIn(resolveTimezone(undefined)),
    });

    const updated = await this.writeWithConflict(invoice.id, set, remove, invoice.version);
    this.events?.invoice(BillingEventType.INVOICE_UPDATED, updated);
    return this.toClientView(updated, items, await this.ledgerFor(invoice.id));
  }

  /** notes / template / dates / terms — the fields both kinds of invoice own. */
  private applyHeader(set: Partial<Invoice> & Record<string, unknown>, remove: string[], input: UpdateInvoiceInput): void {
    if (input.invoiceDate !== undefined) set.invoiceDate = input.invoiceDate;
    if (input.paymentTerms !== undefined) set.paymentTerms = input.paymentTerms;
    if (input.notes !== undefined) {
      if (input.notes === null || input.notes === '') remove.push('notes');
      else set.notes = input.notes;
    }
    if (input.templateId !== undefined) {
      if (input.templateId === null || input.templateId === '') remove.push('templateId');
      else set.templateId = input.templateId;
    }
    if (input.requestSignature !== undefined) set.requestSignature = !!input.requestSignature;
    if (input.display !== undefined) {
      const display = displayOverrides(input.display);
      if (display) set.display = display;
      else remove.push('display');
    }
  }

  private termDaysFor(terms: PaymentTerms, invoice: Invoice, profileCustomDays: number | undefined): number {
    return terms === PaymentTerms.CUSTOM ? this.customSpan(invoice) ?? profileCustomDays ?? 0 : termDays(terms);
  }

  async markSent(id: string, sent: boolean, caller: Caller): Promise<InvoiceView> {
    const invoice = await this.require(id);
    const view = await this.accessView(invoice, caller);
    const now = new Date().toISOString();
    const updated = sent
      ? await this.writeWithConflict(id, { sentAt: now, sentBy: caller.user.id, updatedAt: now }, [], invoice.version)
      : await this.writeWithConflict(id, { updatedAt: now }, ['sentAt', 'sentBy'], invoice.version);
    if (sent && hasJob(invoice)) {
      await this.deal.addTimeline(invoice.dealId, TimelineEventType.INVOICE_SENT, caller.user.id, {
        invoiceId: id,
        number: invoice.number,
      }, caller.user.email);
    }
    this.events?.invoice(BillingEventType.INVOICE_UPDATED, updated);
    return view ? this.toView(updated, view) : this.toClientView(updated, await this.repo.getItems(id));
  }

  async delete(id: string, caller: Caller): Promise<void> {
    const invoice = await this.require(id);
    if (!hasJob(invoice)) {
      this.assertOffice(caller);
      await this.repo.delete(id);
      this.events?.invoice(BillingEventType.INVOICE_DELETED, invoice);
      return;
    }
    const view = await this.deal.getBillingView(invoice.dealId);
    if (view) assertDealAccess(caller, 'invoices', view.deal);
    await this.repo.delete(id);
    await this.deal.setInvoiceLink(invoice.dealId, null).catch((err: Error) => {
      this.logger.warn(`clearing invoice link on ${invoice.dealId} failed: ${err.message}`);
    });
    await this.deal.addTimeline(invoice.dealId, TimelineEventType.INVOICE_DELETED, caller.user.id, {
      invoiceId: id,
      number: invoice.number,
    }, caller.user.email);
    this.events?.invoice(BillingEventType.INVOICE_DELETED, invoice);
  }

  // ------------------------------------------------- lines (client invoices)

  async addItem(id: string, input: InvoiceItemInput, caller: Caller): Promise<InvoiceView> {
    const { invoice, items } = await this.loadClient(id, caller);
    const now = new Date().toISOString();
    const position = items.reduce((max, i) => Math.max(max, i.position), -1) + 1;
    await this.repo.putItem(this.toItem(id, randomUUID(), position, input, now, now));
    return this.recomputeClient(invoice);
  }

  async updateItem(id: string, lineId: string, input: InvoiceItemInput, caller: Caller): Promise<InvoiceView> {
    const { invoice, items } = await this.loadClient(id, caller);
    const current = items.find((i) => i.lineId === lineId);
    if (!current) throw new NotFoundException('Invoice line not found');
    const next = this.toItem(id, lineId, current.position, input, current.createdAt, new Date().toISOString());
    if (input.taxable === undefined) next.taxable = current.taxable;
    await this.repo.putItem(next);
    return this.recomputeClient(invoice);
  }

  async setItemTaxable(id: string, lineId: string, taxable: boolean, caller: Caller): Promise<InvoiceView> {
    const { invoice, items } = await this.loadClient(id, caller);
    const current = items.find((i) => i.lineId === lineId);
    if (!current) throw new NotFoundException('Invoice line not found');
    await this.repo.putItem({ ...current, taxable, updatedAt: new Date().toISOString() });
    return this.recomputeClient(invoice);
  }

  async removeItem(id: string, lineId: string, caller: Caller): Promise<InvoiceView> {
    const { invoice, items } = await this.loadClient(id, caller);
    if (!items.some((i) => i.lineId === lineId)) throw new NotFoundException('Invoice line not found');
    await this.repo.deleteItem(id, lineId);
    return this.recomputeClient(invoice);
  }

  async reorderItems(id: string, lineIds: string[], caller: Caller): Promise<InvoiceView> {
    const { invoice, items } = await this.loadClient(id, caller);
    const moves = reorderPositions(items, lineIds);
    if (moves.length) await this.repo.setPositions(id, moves, new Date().toISOString());
    const byId = new Map(moves.map((m) => [m.lineId, m.position]));
    const reordered = items.map((i) => ({ ...i, position: byId.get(i.lineId) ?? i.position }));
    return this.toClientView(invoice, reordered, await this.ledgerFor(id));
  }

  // ------------------------------------------------------------- documents

  /**
   * The invoice as a PDF. `override.balanceDue` prints another Balance due —
   * a payment schedule's View shows the one payment being asked for (Workiz);
   * the figure comes from the schedule, never from a client.
   */
  async pdf(id: string, download: boolean, caller: Caller, override?: { balanceDue: number }): Promise<{ url: string }> {
    const doc = await this.get(id, caller);
    return this.renderPdf(override ? { ...doc, totals: { ...doc.totals, balanceDue: override.balanceDue } } : doc, download);
  }

  async html(id: string, caller: Caller): Promise<{ html: string }> {
    const doc = await this.get(id, caller);
    return this.requireDocuments().html({ kind: 'invoice', doc, view: await this.viewFor(doc) });
  }

  /** Portal download: the caller already proved ownership through the token. */
  async portalPdf(id: string, download = false): Promise<{ url: string }> {
    const invoice = await this.require(id);
    const view = await this.viewFor(invoice);
    return this.renderPdf(await this.storedView(invoice, view), download, view);
  }

  /** Portal on-screen view: the caller already proved ownership through the token. */
  async portalHtml(id: string): Promise<{ html: string }> {
    const invoice = await this.require(id);
    const view = await this.viewFor(invoice);
    return this.requireDocuments().html({ kind: 'invoice', doc: await this.storedView(invoice, view), view });
  }

  /** The document + its job (none for a client invoice) a template preview renders against. */
  async renderSource(id: string, caller: Caller) {
    const doc = await this.get(id, caller);
    return { kind: 'invoice' as const, doc, view: await this.viewFor(doc) };
  }

  private async renderPdf(doc: InvoiceView, download: boolean, view?: DealBillingView) {
    const v = view ?? (await this.viewFor(doc));
    return this.requireDocuments().pdf(
      { kind: 'invoice', doc, view: v },
      { download, filename: `Invoice-${doc.number}.pdf` },
    );
  }

  /** The stored invoice as a view, without a snapshot refresh or access check. */
  private async storedView(invoice: Invoice, view: DealBillingView | undefined): Promise<InvoiceView> {
    return view ? this.toView(invoice, view) : this.toClientView(invoice, await this.repo.getItems(invoice.id));
  }

  // ------------------------------------------------------------- the ledger

  /**
   * Re-derives the invoice from the payment ledger's answer. Called by
   * PaymentsService on EVERY ledger change; `amountPaid` of 0 is meaningful
   * (a reversal) and pushes the invoice back to `due`/`overdue`.
   */
  async applyAmountPaid(invoiceId: string, amountPaid: number): Promise<Invoice | null> {
    const invoice = await this.repo.get(invoiceId);
    if (!invoice) return null;
    if (!hasJob(invoice)) {
      const fresh = await this.refreshClientSnapshot(invoice, await this.repo.getItems(invoiceId), { amountPaid });
      if (fresh !== invoice) this.events?.invoice(BillingEventType.INVOICE_UPDATED, fresh);
      return fresh;
    }
    const view = await this.deal.getBillingView(invoice.dealId);
    if (!view) return invoice;
    const fresh = await this.refreshSnapshot(invoice, view, false, { amountPaid });
    if (fresh !== invoice) this.events?.invoice(BillingEventType.INVOICE_UPDATED, fresh);
    return fresh;
  }

  /** Workiz "Let client pay with" — the methods offered on THIS invoice. */
  async setAllowedMethods(invoiceId: string, methods: OnlinePaymentMethod[] | null): Promise<Invoice> {
    const invoice = await this.repo.get(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const now = new Date().toISOString();
    if (methods === null) {
      return this.repo.update(invoiceId, { updatedAt: now }, ['allowedMethods'], undefined, SNAPSHOT_WRITE);
    }
    const unique = [...new Set(methods)];
    return this.repo.update(invoiceId, { allowedMethods: unique, updatedAt: now }, [], undefined, SNAPSHOT_WRITE);
  }

  /** The ledger behind `totals.amountPaid`, newest first — `undefined` when unwired. */
  async ledgerFor(invoiceId: string): Promise<{ payments: Payment[]; summary: PaymentSummary } | undefined> {
    if (!this.ledger) return undefined;
    try {
      const rows = await this.ledger.listByInvoice(invoiceId);
      return {
        payments: [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        summary: summarizePayments(rows),
      };
    } catch (err) {
      this.logger.warn(`payment ledger unavailable for invoice ${invoiceId}: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * What the ledger says has been paid, or `undefined` when there is no ledger
   * row at all — in which case the pre-ledger, deal-driven behaviour stands
   * (see `computeInvoiceTotals`), so invoices from before payments existed do
   * not silently flip back to unpaid.
   */
  private async ledgerAmountPaid(invoiceId: string): Promise<number | undefined> {
    if (!this.ledger) return undefined;
    try {
      const rows = await this.ledger.listByInvoice(invoiceId);
      return rows.length ? amountPaidFrom(rows) : undefined;
    } catch (err) {
      this.logger.warn(`payment ledger unavailable for invoice ${invoiceId}: ${(err as Error).message}`);
      return undefined;
    }
  }

  // ------------------------------------------------------- events + sweeps

  /** deal.product_* / deal.updated: re-snapshot totals + status. */
  async refreshFromDeal(dealId: string): Promise<void> {
    const invoice = await this.repo.get(dealId);
    if (!invoice || !hasJob(invoice)) return;
    const view = await this.deal.getBillingView(dealId);
    if (!view) return;
    const fresh = await this.refreshSnapshot(invoice, view, true);
    if (fresh !== invoice) this.events?.invoice(BillingEventType.INVOICE_UPDATED, fresh);
  }

  /** deal.deleted: the job is gone, so is its invoice. */
  async deleteForDeal(dealId: string): Promise<void> {
    const invoice = await this.repo.get(dealId);
    if (!invoice || !hasJob(invoice)) return;
    await this.repo.delete(dealId);
    this.events?.invoice(BillingEventType.INVOICE_DELETED, invoice);
  }

  /**
   * Flips `due` invoices whose due date has passed to `overdue`, from the
   * stored snapshot (no deal calls). Returns how many changed.
   *
   * The candidates come off UnpaidIndex (~600 open invoices) once it is
   * built; before that, and when the index reader is not wired (unit tests),
   * from the whole list with a filter, as it always did.
   */
  async sweepOverdue(today: string = todayIn(resolveTimezone(undefined))): Promise<number> {
    const candidates = await this.overdueCandidates(today);
    let changed = 0;
    for (const inv of candidates) {
      const status = deriveInvoiceStatus({ totals: inv.totals, dueDate: inv.dueDate, today });
      if (status === inv.status) continue;
      try {
        const updated = await this.repo.update(
          inv.id,
          { status, updatedAt: new Date().toISOString() },
          [],
          undefined,
          SNAPSHOT_WRITE,
        );
        this.events?.invoice(BillingEventType.INVOICE_UPDATED, updated);
        changed++;
      } catch (err) {
        this.logger.warn(`overdue sweep: ${inv.id} failed: ${(err as Error).message}`);
      }
    }
    return changed;
  }

  private async overdueCandidates(today: string): Promise<Invoice[]> {
    if (this.unpaid && (await this.unpaid.isReady())) {
      const { items } = await this.unpaid.listUnpaid();
      return items.filter((i) => i.status === 'due' && typeof i.dueDate === 'string' && i.dueDate < today);
    }
    return this.repo.listAll({
      expression: '#status = :due AND #dueDate < :today',
      names: { '#status': 'status', '#dueDate': 'dueDate' },
      values: { ':due': 'due', ':today': today },
    });
  }

  // -------------------------------------------------------------- helpers

  private async require(id: string): Promise<Invoice> {
    const invoice = await this.repo.get(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /** A client invoice has no job: a technician's `assigned_only` scope cannot reach it. */
  private assertOffice(caller: Caller): void {
    if (isAssignedOnly(caller, 'invoices')) {
      throw new ForbiddenException('This invoice belongs to the client and has no job you are assigned to');
    }
  }

  /** The job's view after the caller's scope check, or nothing for a client invoice (office-only). */
  private async accessView(invoice: Invoice, caller: Caller): Promise<DealBillingView | undefined> {
    if (!hasJob(invoice)) {
      this.assertOffice(caller);
      return undefined;
    }
    const view = await this.loadView(invoice.dealId);
    assertDealAccess(caller, 'invoices', view.deal);
    return view;
  }

  /** The job's billing view, or nothing for a client invoice. */
  private async viewFor(invoice: Pick<Invoice, 'dealId'>): Promise<DealBillingView | undefined> {
    return invoice.dealId ? this.loadView(invoice.dealId) : undefined;
  }

  /** A client invoice + its rows, for a line edit; a job invoice's lines are the job's (422). */
  private async loadClient(id: string, caller: Caller): Promise<{ invoice: Invoice; items: InvoiceItem[] }> {
    const invoice = await this.require(id);
    if (hasJob(invoice)) {
      throw new UnprocessableEntityException(
        "This invoice is the job's — its lines are the job's items, edit them on the job",
      );
    }
    this.assertOffice(caller);
    return { invoice, items: await this.repo.getItems(id) };
  }

  /** A client invoice's full view: scope check, fresh snapshot, ledger. */
  private async clientView(invoice: Invoice, caller: Caller): Promise<InvoiceView> {
    this.assertOffice(caller);
    const items = await this.repo.getItems(invoice.id);
    const fresh = await this.refreshClientSnapshot(invoice, items);
    return this.toClientView(fresh, items, await this.ledgerFor(invoice.id));
  }

  /** Re-reads the rows after a line write so concurrent edits are counted. */
  private async recomputeClient(invoice: Invoice): Promise<InvoiceView> {
    const items = await this.repo.getItems(invoice.id);
    const fresh = await this.refreshClientSnapshot(invoice, items, undefined, true);
    this.events?.invoice(BillingEventType.INVOICE_UPDATED, fresh);
    return this.toClientView(fresh, items, await this.ledgerFor(invoice.id));
  }

  /**
   * A client invoice's totals + status from its own rows and the ledger. Like
   * `refreshSnapshot`, never bumps `version`. No ledger row ⇒ nothing paid.
   */
  private async refreshClientSnapshot(
    invoice: Invoice,
    items: InvoiceItem[],
    known?: { amountPaid?: number },
    bumpAlways = false,
  ): Promise<Invoice> {
    const amountPaid = (known ? known.amountPaid : await this.ledgerAmountPaid(invoice.id)) ?? 0;
    const totals = computeClientInvoiceTotals(invoice, items, { amountPaid });
    const status = deriveInvoiceStatus({ totals, dueDate: invoice.dueDate, today: todayIn(resolveTimezone(undefined)) });
    if (!bumpAlways && status === invoice.status && sameTotals(invoice.totals, totals)) return invoice;
    try {
      return await this.repo.update(
        invoice.id,
        { totals, status, updatedAt: new Date().toISOString() },
        [],
        undefined,
        SNAPSHOT_WRITE,
      );
    } catch (err) {
      this.logger.warn(`invoice ${invoice.id} snapshot refresh failed: ${(err as Error).message}`);
      return { ...invoice, totals, status };
    }
  }

  private toClientView(
    invoice: Invoice,
    items: InvoiceItem[],
    ledger?: { payments: Payment[]; summary: PaymentSummary },
  ): InvoiceView {
    return {
      ...invoice,
      items: ownLines(items),
      ...(ledger && { payments: ledger.payments, paymentSummary: ledger.summary }),
    };
  }

  private toItem(
    invoiceId: string,
    lineId: string,
    position: number,
    input: InvoiceItemInput,
    createdAt: string,
    updatedAt: string,
  ): InvoiceItem {
    return {
      lineId,
      invoiceId,
      position,
      productId: input.productId,
      ...(input.productType && { productType: input.productType }),
      name: input.name,
      sku: input.sku,
      ...(input.description?.trim() && { description: input.description.trim() }),
      quantity: input.quantity,
      priceClient: input.priceClient,
      costCompany: input.costCompany,
      costForTech: input.costForTech,
      taxable: input.taxable !== false,
      createdAt,
      updatedAt,
    };
  }

  private async refreshSnapshot(
    invoice: Invoice,
    view: DealBillingView,
    bumpAlways = false,
    known?: { amountPaid?: number },
  ): Promise<Invoice> {
    const amountPaid = known ? known.amountPaid : await this.ledgerAmountPaid(invoice.id);
    const totals = computeInvoiceTotals(view, { amountPaid });
    const tz = await this.timezoneFor(view.deal.serviceAreaId);
    const status: InvoiceStatus = deriveInvoiceStatus({
      totals,
      dueDate: invoice.dueDate,
      today: todayIn(tz),
      ...(amountPaid === undefined && { paymentStatus: view.deal.paymentStatus }),
    });
    const contactChanged = view.deal.contactId && view.deal.contactId !== invoice.contactId;
    if (!bumpAlways && status === invoice.status && sameTotals(invoice.totals, totals) && !contactChanged) {
      return invoice;
    }
    try {
      return await this.repo.update(
        invoice.id,
        {
          totals,
          status,
          updatedAt: new Date().toISOString(),
          ...(contactChanged && { contactId: view.deal.contactId, createdAt: invoice.createdAt }),
        },
        [],
        undefined,
        SNAPSHOT_WRITE,
      );
    } catch (err) {
      this.logger.warn(`invoice ${invoice.id} snapshot refresh failed: ${(err as Error).message}`);
      return { ...invoice, totals, status };
    }
  }

  private toView(
    invoice: Invoice,
    view: DealBillingView,
    ledger?: { payments: Payment[]; summary: PaymentSummary },
  ): InvoiceView {
    const d = view.deal;
    return {
      ...invoice,
      items: toBillingLines(view),
      ...(ledger && { payments: ledger.payments, paymentSummary: ledger.summary }),
      ...(d.taxRateId && { taxRateId: d.taxRateId }),
      ...(d.taxRateName && { taxRateName: d.taxRateName }),
      ...(d.taxRatePercent !== undefined && { taxRatePercent: d.taxRatePercent }),
      ...(d.taxSource && { taxSource: d.taxSource }),
      ...(d.discount && { discount: d.discount }),
    };
  }

  private async loadView(dealId: string): Promise<DealBillingView> {
    const view = await this.deal.getBillingView(dealId);
    if (!view) throw new NotFoundException('Job not found');
    return view;
  }

  private async timezoneFor(serviceAreaId?: string): Promise<string> {
    if (!serviceAreaId) return resolveTimezone(undefined);
    const areas = await this.deal.listServiceAreas().catch(() => []);
    return resolveTimezone(areas.find((a) => a.id === serviceAreaId)?.timezone);
  }

  private daysFor(
    terms: PaymentTerms,
    company: { customTermsDays?: number; paymentTerms?: string } | null,
    profileCustomDays: number | undefined,
    contact: { customTermsDays?: number; paymentTerms?: string } | null,
  ): number {
    if (terms !== PaymentTerms.CUSTOM) return termDays(terms);
    const source = contact?.paymentTerms ? contact : company?.paymentTerms ? company : null;
    return termDays(terms, source?.customTermsDays ?? profileCustomDays);
  }

  private customSpan(invoice: Invoice): number | undefined {
    if (invoice.paymentTerms !== PaymentTerms.CUSTOM) return undefined;
    const a = Date.parse(`${invoice.invoiceDate}T00:00:00Z`);
    const b = Date.parse(`${invoice.dueDate}T00:00:00Z`);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : undefined;
  }

  private async writeWithConflict(
    id: string,
    set: Partial<Invoice> & Record<string, unknown>,
    remove: string[],
    expectedVersion: number,
  ): Promise<Invoice> {
    try {
      return await this.repo.update(id, set, remove, expectedVersion);
    } catch (err) {
      if (err instanceof InvoiceVersionConflictError) {
        throw new ConflictException('The invoice changed meanwhile — reload and try again');
      }
      throw err;
    }
  }

  private visible = async (items: Invoice[], caller: Caller): Promise<Invoice[]> => {
    if (!isAssignedOnly(caller, 'invoices')) return items;
    const mine = await this.deal.listDealIdsByTech(caller.user.id);
    return items.filter((i) => onMyJobs(i, mine));
  };

  private requireDocuments(): DocumentsService {
    if (!this.documents) throw new Error('DocumentsService not wired');
    return this.documents;
  }
}
