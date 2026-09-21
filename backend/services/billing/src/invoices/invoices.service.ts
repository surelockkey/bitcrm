import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import {
  BillingEventType,
  PaymentTerms,
  TimelineEventType,
  lineAmount,
  type BillingLine,
  type DocumentTotals,
  type Invoice,
  type InvoiceStatus,
  type InvoiceView,
} from '@bitcrm/types';
import { assertDealAccess, isAssignedOnly, type Caller } from '../common/access';
import { isYmd, resolveTimezone, todayIn } from '../common/dates';
import { BusinessProfileService } from '../business-profile/business-profile.service';
import { DocumentsService } from '../documents/documents.service';
import { BillingEventsPublisher } from '../integrations/billing-events.publisher';
import { CrmClient } from '../integrations/crm.client';
import { DealClient, type DealBillingView } from '../integrations/deal.client';
import {
  computeDueDate,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  dueDateBasisDate,
  resolvePaymentTerms,
  termDays,
} from './invoice-rules';
import {
  InvoiceExistsError,
  InvoiceVersionConflictError,
  InvoicesRepository,
  type InvoiceListFilter,
} from './invoices.repository';

export interface UpdateInvoiceInput {
  invoiceDate?: string;
  paymentTerms?: PaymentTerms;
  dueDate?: string;
  notes?: string | null;
  templateId?: string | null;
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
}

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

/** Key-order-insensitive: DynamoDB does not preserve the order of a map's keys. */
const sameTotals = (a: DocumentTotals | undefined, b: DocumentTotals) => !!a && isDeepStrictEqual({ ...a }, { ...b });

/**
 * Job invoices (Workiz): one per job, id + number are the job's, and the
 * items / tax / discount ARE the job's — the invoice stores only its own
 * fields plus a totals + status snapshot for lists.
 */
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
  ) {}

  // ---------------------------------------------------------------- create

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
    const totals = computeInvoiceTotals(view);

    const invoice: Invoice = {
      id: deal.id,
      number: deal.dealNumber,
      dealId: deal.id,
      contactId: deal.contactId,
      ...(deal.companyId && { companyId: deal.companyId }),
      invoiceDate,
      paymentTerms: terms,
      dueDate,
      status: deriveInvoiceStatus({ totals, dueDate, today: invoiceDate, paymentStatus: deal.paymentStatus }),
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

  // ------------------------------------------------------------------ read

  async get(id: string, caller: Caller): Promise<InvoiceView> {
    const invoice = await this.repo.get(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const view = await this.loadView(invoice.dealId);
    assertDealAccess(caller, 'invoices', view.deal);
    const fresh = await this.refreshSnapshot(invoice, view);
    return this.toView(fresh, view);
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

  listForContact(contactId: string): Promise<Invoice[]> {
    return this.repo.list({ contactId, limit: 200 }).then((r) => r.items);
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
      // job list is capped at 100 by deal-service (`internal/by-tech`).
      const mine = await this.deal.listDealIdsByTech(caller.user.id);
      result = { ...result, items: result.items.filter((i) => mine.has(i.dealId)) };
    }
    return result;
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
    };
    for (const inv of all) {
      const balance = inv.totals?.balanceDue ?? 0;
      if (inv.status === 'due') {
        s.dueCount++;
        s.dueAmount += balance;
      } else if (inv.status === 'overdue') {
        s.overdueCount++;
        s.overdueAmount += balance;
      } else if (inv.status === 'paid') {
        s.paidCount++;
        s.paidAmount += inv.totals?.amountPaid ?? inv.totals?.total ?? 0;
      }
      if (!inv.sentAt) s.unsentCount++;
    }
    s.dueAmount = round2(s.dueAmount);
    s.overdueAmount = round2(s.overdueAmount);
    s.paidAmount = round2(s.paidAmount);
    s.needsInvoiceCount = (await this.needingInvoice(authorization)).length;
    return s;
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
    const invoice = await this.repo.get(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const view = await this.loadView(invoice.dealId);
    assertDealAccess(caller, 'invoices', view.deal);

    if (input.invoiceDate !== undefined && !isYmd(input.invoiceDate)) {
      throw new BadRequestException('invoiceDate must be YYYY-MM-DD');
    }
    if (input.dueDate !== undefined && !isYmd(input.dueDate)) {
      throw new BadRequestException('dueDate must be YYYY-MM-DD');
    }

    const set: Partial<Invoice> & Record<string, unknown> = { updatedAt: new Date().toISOString() };
    const remove: string[] = [];
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

    if (input.dueDate !== undefined) {
      set.dueDate = input.dueDate;
    } else if (input.paymentTerms !== undefined || input.invoiceDate !== undefined) {
      const [profile, tz] = await Promise.all([
        this.profiles.get(view.deal.businessProfileId),
        this.timezoneFor(view.deal.serviceAreaId),
      ]);
      const terms = input.paymentTerms ?? invoice.paymentTerms;
      const days =
        terms === PaymentTerms.CUSTOM
          ? this.customSpan(invoice) ?? profile.defaultCustomTermDays ?? 0
          : termDays(terms);
      const basis = dueDateBasisDate(profile, {
        invoiceDate: (set.invoiceDate as string | undefined) ?? invoice.invoiceDate,
        deal: view.deal,
        timezone: tz,
      });
      set.dueDate = computeDueDate(basis, days);
    }

    const totals = computeInvoiceTotals(view);
    const tz = await this.timezoneFor(view.deal.serviceAreaId);
    set.totals = totals;
    set.status = deriveInvoiceStatus({
      totals,
      dueDate: (set.dueDate as string | undefined) ?? invoice.dueDate,
      today: todayIn(tz),
      paymentStatus: view.deal.paymentStatus,
    });

    const updated = await this.writeWithConflict(id, set, remove, invoice.version);
    await this.deal.addTimeline(invoice.dealId, TimelineEventType.INVOICE_UPDATED, caller.user.id, {
      invoiceId: id,
      fields: Object.keys(input),
    }, caller.user.email);
    this.events?.invoice(BillingEventType.INVOICE_UPDATED, updated);
    return this.toView(updated, view);
  }

  async markSent(id: string, sent: boolean, caller: Caller): Promise<InvoiceView> {
    const invoice = await this.repo.get(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const view = await this.loadView(invoice.dealId);
    assertDealAccess(caller, 'invoices', view.deal);
    const now = new Date().toISOString();
    const updated = sent
      ? await this.writeWithConflict(id, { sentAt: now, sentBy: caller.user.id, updatedAt: now }, [], invoice.version)
      : await this.writeWithConflict(id, { updatedAt: now }, ['sentAt', 'sentBy'], invoice.version);
    if (sent) {
      await this.deal.addTimeline(invoice.dealId, TimelineEventType.INVOICE_SENT, caller.user.id, {
        invoiceId: id,
        number: invoice.number,
      }, caller.user.email);
    }
    this.events?.invoice(BillingEventType.INVOICE_UPDATED, updated);
    return this.toView(updated, view);
  }

  async delete(id: string, caller: Caller): Promise<void> {
    const invoice = await this.repo.get(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
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

  // ------------------------------------------------------------- documents

  async pdf(id: string, download: boolean, caller: Caller): Promise<{ url: string }> {
    const doc = await this.get(id, caller);
    return this.renderPdf(doc, download);
  }

  async html(id: string, caller: Caller): Promise<{ html: string }> {
    const doc = await this.get(id, caller);
    const view = await this.loadView(doc.dealId);
    return this.requireDocuments().html({ kind: 'invoice', doc, view });
  }

  /** Portal download: the caller already proved ownership through the token. */
  async portalPdf(id: string, download = false): Promise<{ url: string }> {
    const invoice = await this.repo.get(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const view = await this.loadView(invoice.dealId);
    return this.renderPdf(this.toView(invoice, view), download, view);
  }

  /** Portal on-screen view: the caller already proved ownership through the token. */
  async portalHtml(id: string): Promise<{ html: string }> {
    const invoice = await this.repo.get(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const view = await this.loadView(invoice.dealId);
    return this.requireDocuments().html({ kind: 'invoice', doc: this.toView(invoice, view), view });
  }

  /** The document + job a template preview renders against. */
  async renderSource(id: string, caller: Caller) {
    const doc = await this.get(id, caller);
    const view = await this.loadView(doc.dealId);
    return { kind: 'invoice' as const, doc, view };
  }

  private async renderPdf(doc: InvoiceView, download: boolean, view?: DealBillingView) {
    const v = view ?? (await this.loadView(doc.dealId));
    return this.requireDocuments().pdf(
      { kind: 'invoice', doc, view: v },
      { download, filename: `Invoice-${doc.number}.pdf` },
    );
  }

  // ------------------------------------------------------- events + sweeps

  /** deal.product_* / deal.updated: re-snapshot totals + status. */
  async refreshFromDeal(dealId: string): Promise<void> {
    const invoice = await this.repo.get(dealId);
    if (!invoice) return;
    const view = await this.deal.getBillingView(dealId);
    if (!view) return;
    const fresh = await this.refreshSnapshot(invoice, view, true);
    if (fresh !== invoice) this.events?.invoice(BillingEventType.INVOICE_UPDATED, fresh);
  }

  /** deal.deleted: the job is gone, so is its invoice. */
  async deleteForDeal(dealId: string): Promise<void> {
    const invoice = await this.repo.get(dealId);
    if (!invoice) return;
    await this.repo.delete(dealId);
    this.events?.invoice(BillingEventType.INVOICE_DELETED, invoice);
  }

  /**
   * Flips `due` invoices whose due date has passed to `overdue`, from the
   * stored snapshot (no deal calls). Returns how many changed.
   */
  async sweepOverdue(today: string = todayIn(resolveTimezone(undefined))): Promise<number> {
    const candidates = await this.repo.listAll({
      expression: '#status = :due AND #dueDate < :today',
      names: { '#status': 'status', '#dueDate': 'dueDate' },
      values: { ':due': 'due', ':today': today },
    });
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

  // -------------------------------------------------------------- helpers

  private async refreshSnapshot(invoice: Invoice, view: DealBillingView, bumpAlways = false): Promise<Invoice> {
    const totals = computeInvoiceTotals(view);
    const tz = await this.timezoneFor(view.deal.serviceAreaId);
    const status: InvoiceStatus = deriveInvoiceStatus({
      totals,
      dueDate: invoice.dueDate,
      today: todayIn(tz),
      paymentStatus: view.deal.paymentStatus,
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

  private toView(invoice: Invoice, view: DealBillingView): InvoiceView {
    const d = view.deal;
    return {
      ...invoice,
      items: toBillingLines(view),
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
    return items.filter((i) => mine.has(i.dealId));
  };

  private requireDocuments(): DocumentsService {
    if (!this.documents) throw new Error('DocumentsService not wired');
    return this.documents;
  }
}
