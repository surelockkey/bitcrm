import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BillingEventType, TimelineEventType, type Invoice, type InvoiceItem } from '@bitcrm/types';
import { InvoicesService } from 'src/invoices/invoices.service';
import { InvoiceExistsError, InvoiceVersionConflictError } from 'src/invoices/invoices.repository';
import {
  DataScope,
  NOW,
  PaymentTerms,
  billingView,
  caller,
  dealProduct,
  mockCrmClient,
  mockDealClient,
  mockDocuments,
  mockEvents,
  mockProfileService,
  profile,
} from './mocks';

function mockRepo() {
  const store = new Map<string, Invoice>();
  const items = new Map<string, Map<string, InvoiceItem>>();
  let accountSeq = 0;
  const itemsOf = (id: string) => {
    if (!items.has(id)) items.set(id, new Map());
    return items.get(id)!;
  };
  return {
    store,
    items,
    nextAccountSeq: jest.fn(async () => ++accountSeq),
    create: jest.fn(async (inv: Invoice) => {
      if (store.has(inv.id)) throw new InvoiceExistsError();
      store.set(inv.id, inv);
    }),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    getItems: jest.fn(async (id: string) =>
      [...itemsOf(id).values()].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
    ),
    putItem: jest.fn(async (i: InvoiceItem) => void itemsOf(i.invoiceId).set(i.lineId, i)),
    deleteItem: jest.fn(async (id: string, lineId: string) => void itemsOf(id).delete(lineId)),
    setPositions: jest.fn(async (id: string, positions: Array<{ lineId: string; position: number }>) => {
      for (const p of positions) itemsOf(id).get(p.lineId)!.position = p.position;
    }),
    update: jest.fn(
      async (
        id: string,
        set: Partial<Invoice>,
        remove: string[] = [],
        expectedVersion?: number,
        opts: { bumpVersion?: boolean } = {},
      ) => {
        const prev = store.get(id)!;
        if (expectedVersion !== undefined && prev.version !== expectedVersion) {
          throw new InvoiceVersionConflictError();
        }
        const cur = { ...prev, ...set } as Record<string, unknown>;
        for (const k of remove) delete cur[k];
        for (const [k, v] of Object.entries(set)) if (v === null) delete cur[k];
        cur.version = opts.bumpVersion === false ? prev.version : (prev.version ?? 0) + 1;
        store.set(id, cur as unknown as Invoice);
        return cur as unknown as Invoice;
      },
    ),
    delete: jest.fn(async (id: string) => {
      store.delete(id);
      items.delete(id);
    }),
    list: jest.fn(async (filter?: { contactId?: string }) => ({
      items: [...store.values()].filter((i) => !filter?.contactId || i.contactId === filter.contactId),
    })),
    listAll: jest.fn(async () => [...store.values()]),
  };
}

const itemDto = (over: Record<string, unknown> = {}) => ({
  productId: 'p-9',
  name: 'Smart lock',
  sku: 'SL-9',
  quantity: 1,
  priceClient: 200,
  costCompany: 120,
  costForTech: 20,
  ...over,
});

describe('InvoicesService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let deal: ReturnType<typeof mockDealClient>;
  let crm: ReturnType<typeof mockCrmClient>;
  let profiles: ReturnType<typeof mockProfileService>;
  let events: ReturnType<typeof mockEvents>;
  let documents: ReturnType<typeof mockDocuments>;
  let service: InvoicesService;

  const build = (ledger?: { listByInvoice: jest.Mock }) =>
    new InvoicesService(
      repo as never,
      deal as never,
      crm as never,
      profiles as never,
      documents as never,
      events as never,
      undefined,
      ledger as never,
    );

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    repo = mockRepo();
    deal = mockDealClient();
    crm = mockCrmClient();
    profiles = mockProfileService();
    events = mockEvents();
    documents = mockDocuments();
    service = build();
  });
  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    it('creates the job invoice: id and number are the job’s', async () => {
      const inv = await service.create('deal-1', caller());
      expect(inv.id).toBe('deal-1');
      expect(inv.dealId).toBe('deal-1');
      expect(inv.number).toBe('K4T9ZW');
      expect(inv.contactId).toBe('contact-1');
      expect(inv.invoiceDate).toBe('2026-09-16');
      expect(inv.version).toBe(1);
      expect(inv.items).toHaveLength(1);
      expect(inv.items[0]).toMatchObject({ lineId: 'p-1', amount: 100, taxable: true });
      expect(inv.taxRatePercent).toBe(6.35);
      expect(inv.totals.total).toBe(106.35);
      expect(inv.status).toBe('due');
    });

    it('links the job, logs the timeline and publishes invoice.created', async () => {
      await service.create('deal-1', caller());
      expect(deal.setInvoiceLink).toHaveBeenCalledWith('deal-1', 'deal-1');
      expect(deal.addTimeline).toHaveBeenCalledWith(
        'deal-1',
        TimelineEventType.INVOICE_CREATED,
        'u-1',
        expect.objectContaining({ invoiceId: 'deal-1', number: 'K4T9ZW' }),
        'dispatcher@example.com',
      );
      expect(events.invoice).toHaveBeenCalledWith(BillingEventType.INVOICE_CREATED, expect.anything());
    });

    it('404s for an unknown job', async () => {
      deal.getBillingView.mockResolvedValueOnce(null as never);
      await expect(service.create('nope', caller())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('422s when the job has no items', async () => {
      deal.getBillingView.mockResolvedValueOnce(billingView({ itemCount: 0 }, []));
      await expect(service.create('deal-1', caller())).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('409s when the job already has an invoice (conditional put)', async () => {
      await service.create('deal-1', caller());
      await expect(service.create('deal-1', caller())).rejects.toBeInstanceOf(ConflictException);
    });

    it('rolls the invoice back when the job cannot be linked', async () => {
      deal.setInvoiceLink.mockRejectedValueOnce(new Error('deal down'));
      await expect(service.create('deal-1', caller())).rejects.toThrow('deal down');
      expect(repo.store.has('deal-1')).toBe(false);
    });

    it('uses cash (due today) from the default profile', async () => {
      const inv = await service.create('deal-1', caller());
      expect(inv.paymentTerms).toBe(PaymentTerms.CASH);
      expect(inv.dueDate).toBe('2026-09-16');
    });

    it('uses the company terms before the profile default', async () => {
      deal.getBillingView.mockResolvedValueOnce(billingView({ companyId: 'co-1' }));
      crm.getCompany.mockResolvedValueOnce({ id: 'co-1', paymentTerms: PaymentTerms.NET_30 });
      profiles.get.mockResolvedValue(profile({ defaultPaymentTerms: PaymentTerms.NET_15 }));
      const inv = await service.create('deal-1', caller());
      expect(inv.companyId).toBe('co-1');
      expect(inv.paymentTerms).toBe(PaymentTerms.NET_30);
      expect(inv.dueDate).toBe('2026-10-16');
    });

    it("takes the default terms from the job's company", async () => {
      deal.getBillingView.mockResolvedValueOnce(billingView({ businessProfileId: 'bp-2' }));
      profiles.get.mockImplementation(async (id?: string) =>
        profile(id === 'bp-2' ? { id: 'bp-2', defaultPaymentTerms: PaymentTerms.NET_15 } : {}),
      );
      const inv = await service.create('deal-1', caller());
      expect(profiles.get).toHaveBeenCalledWith('bp-2');
      expect(inv.paymentTerms).toBe(PaymentTerms.NET_15);
      expect(inv.dueDate).toBe('2026-10-01');
    });

    it('uses the profile default and its custom days', async () => {
      profiles.get.mockResolvedValue(
        profile({ defaultPaymentTerms: PaymentTerms.CUSTOM, defaultCustomTermDays: 10 }),
      );
      const inv = await service.create('deal-1', caller());
      expect(inv.paymentTerms).toBe(PaymentTerms.CUSTOM);
      expect(inv.dueDate).toBe('2026-09-26');
    });

    it('counts from the job’s scheduled date when the profile says so', async () => {
      deal.getBillingView.mockResolvedValueOnce(billingView({ scheduledDate: '2026-09-01' }));
      profiles.get.mockResolvedValue(
        profile({ defaultPaymentTerms: PaymentTerms.NET_15, dueDateBasis: 'job_scheduled' }),
      );
      const inv = await service.create('deal-1', caller());
      expect(inv.dueDate).toBe('2026-09-16');
    });

    it('is refused for a technician not assigned to the job', async () => {
      await expect(
        service.create('deal-1', caller(DataScope.ASSIGNED_ONLY, { id: 'tech-9' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is allowed for the assigned technician', async () => {
      await expect(
        service.create('deal-1', caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' })),
      ).resolves.toBeDefined();
    });
  });

  describe('get / derived status', () => {
    beforeEach(async () => {
      await service.create('deal-1', caller());
    });

    it('returns live items and refreshes a changed totals snapshot', async () => {
      deal.getBillingView.mockResolvedValueOnce(
        billingView({}, [dealProduct(), dealProduct({ productId: 'p-2', priceClient: 10, quantity: 1 })]),
      );
      const inv = await service.get('deal-1', caller());
      expect(inv.items).toHaveLength(2);
      expect(inv.totals.subtotal).toBe(110);
      expect(repo.update).toHaveBeenCalledWith(
        'deal-1',
        expect.objectContaining({ totals: inv.totals }),
        [],
        undefined,
        { bumpVersion: false },
      );
    });

    it('does not rewrite an unchanged snapshot whose stored keys came back reordered', async () => {
      // DynamoDB does not preserve map key order.
      const stored = repo.store.get('deal-1')!;
      const reordered = Object.fromEntries(Object.entries(stored.totals).reverse()) as typeof stored.totals;
      repo.store.set('deal-1', { ...stored, totals: reordered });
      repo.update.mockClear();
      await service.get('deal-1', caller());
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('is paid when the job is paid, with amountPaid from actualTotal', async () => {
      deal.getBillingView.mockResolvedValueOnce(billingView({ paymentStatus: 'paid', actualTotal: 50 }));
      const inv = await service.get('deal-1', caller());
      expect(inv.status).toBe('paid');
      expect(inv.totals.amountPaid).toBe(50);
    });

    it('is overdue once the due date passed', async () => {
      jest.setSystemTime(new Date('2026-09-18T15:00:00.000Z'));
      const inv = await service.get('deal-1', caller());
      expect(inv.status).toBe('overdue');
    });

    it('is no_amount when the job total is zero', async () => {
      deal.getBillingView.mockResolvedValueOnce(billingView({}, [dealProduct({ priceClient: 0 })]));
      const inv = await service.get('deal-1', caller());
      expect(inv.status).toBe('no_amount');
    });

    it('404s for a missing invoice and null by-deal', async () => {
      await expect(service.get('other', caller())).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getByDeal('other', caller())).resolves.toBeNull();
    });

    it('hides the invoice from an unassigned technician', async () => {
      await expect(
        service.get('deal-1', caller(DataScope.ASSIGNED_ONLY, { id: 'tech-9' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update / send / delete', () => {
    beforeEach(async () => {
      await service.create('deal-1', caller());
    });

    it('recomputes the due date when the terms change', async () => {
      const inv = await service.update('deal-1', { paymentTerms: PaymentTerms.NET_15 }, caller());
      expect(inv.paymentTerms).toBe(PaymentTerms.NET_15);
      expect(inv.dueDate).toBe('2026-10-01');
    });

    it('keeps an explicit due date', async () => {
      const inv = await service.update(
        'deal-1',
        { paymentTerms: PaymentTerms.CUSTOM, dueDate: '2026-12-01', notes: 'Thanks' },
        caller(),
      );
      expect(inv.dueDate).toBe('2026-12-01');
      expect(inv.notes).toBe('Thanks');
    });

    it('clears the template with null', async () => {
      await service.update('deal-1', { templateId: 'tpl-x' }, caller());
      const inv = await service.update('deal-1', { templateId: null }, caller());
      expect(inv.templateId).toBeUndefined();
    });

    it('mark-sent stamps sentAt/sentBy and logs INVOICE_SENT; unsend clears', async () => {
      const sent = await service.markSent('deal-1', true, caller());
      expect(sent.sentAt).toBe(NOW);
      expect(sent.sentBy).toBe('u-1');
      expect(deal.addTimeline).toHaveBeenCalledWith('deal-1', TimelineEventType.INVOICE_SENT, 'u-1', expect.anything(), 'dispatcher@example.com');
      const unsent = await service.markSent('deal-1', false, caller());
      expect(unsent.sentAt).toBeUndefined();
    });

    it('delete removes the invoice and clears the job link', async () => {
      await service.delete('deal-1', caller());
      expect(repo.store.has('deal-1')).toBe(false);
      expect(deal.setInvoiceLink).toHaveBeenLastCalledWith('deal-1', null);
      expect(deal.addTimeline).toHaveBeenCalledWith('deal-1', TimelineEventType.INVOICE_DELETED, 'u-1', expect.anything(), 'dispatcher@example.com');
      expect(events.invoice).toHaveBeenCalledWith(BillingEventType.INVOICE_DELETED, expect.anything());
    });
  });

  describe('deal events + sweep', () => {
    it('refreshFromDeal re-snapshots totals without bumping the version', async () => {
      await service.create('deal-1', caller());
      deal.getBillingView.mockResolvedValueOnce(billingView({}, [dealProduct({ quantity: 5 })]));
      await service.refreshFromDeal('deal-1');
      const stored = repo.store.get('deal-1')!;
      expect(stored.totals.subtotal).toBe(250);
      // `version` guards user edits; a derived refresh landing between a
      // user's read and write must not turn that write into a 409.
      expect(stored.version).toBe(1);
    });

    it('a snapshot refresh racing a user edit does not make the edit conflict', async () => {
      await service.create('deal-1', caller());
      // The deal-events refresh lands while mark-sent is loading the job.
      deal.getBillingView.mockImplementationOnce(async () => {
        await service.refreshFromDeal('deal-1');
        return billingView();
      });
      deal.getBillingView.mockResolvedValueOnce(billingView({}, [dealProduct({ quantity: 5 })]));
      const sent = await service.markSent('deal-1', true, caller());
      expect(sent.sentAt).toBeDefined();
      expect(sent.version).toBe(2);
    });

    it('refreshFromDeal ignores jobs without an invoice', async () => {
      await service.refreshFromDeal('deal-x');
      expect(deal.getBillingView).not.toHaveBeenCalled();
    });

    it('the overdue sweep flips due invoices past their due date', async () => {
      await service.create('deal-1', caller());
      const n = await service.sweepOverdue('2026-09-20');
      expect(n).toBe(1);
      expect(repo.store.get('deal-1')!.status).toBe('overdue');
      expect(repo.store.get('deal-1')!.version).toBe(1);
    });
  });

  describe('list', () => {
    it('filters to the technician’s own jobs under assigned_only', async () => {
      repo.store.set('deal-1', { id: 'deal-1', dealId: 'deal-1' } as Invoice);
      repo.store.set('deal-2', { id: 'deal-2', dealId: 'deal-2' } as Invoice);
      deal.listDealIdsByTech.mockResolvedValueOnce(new Set(['deal-2']));
      const res = await service.list({ limit: 20 }, caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' }));
      expect(res.items.map((i) => i.id)).toEqual(['deal-2']);
      expect(deal.listDealIdsByTech).toHaveBeenCalledWith('tech-1');
    });
  });

  /**
   * Workiz: a client's card has Create new → Invoice, which makes an invoice
   * for the client with no job. It owns its own lines and tax/discount (a job
   * invoice reads the job's), is numbered from the account counter, takes its
   * due date from the CLIENT's payment terms and, having no job, is office-only.
   */
  describe('client invoices (no job)', () => {
    const noJob = () => service.createForClient('contact-1', caller());

    it('creates for the client: fresh id, stub number, client terms, no job, no items', async () => {
      crm.getContact.mockResolvedValueOnce({
        id: 'contact-1',
        firstName: 'Jane',
        lastName: 'Client',
        companyId: 'co-9',
        paymentTerms: PaymentTerms.NET_30,
        taxExempt: true,
        addresses: [],
      });
      const inv = await noJob();
      expect(inv.id).not.toBe('deal-1');
      expect(inv.id).not.toBe('contact-1');
      expect(inv.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(inv.dealId).toBeUndefined();
      expect(repo.nextAccountSeq).toHaveBeenCalledTimes(1);
      expect(inv).toMatchObject({
        number: '1001',
        contactId: 'contact-1',
        companyId: 'co-9',
        invoiceDate: '2026-09-16',
        paymentTerms: PaymentTerms.NET_30,
        dueDate: '2026-10-16',
        taxSource: 'exempt',
        taxRatePercent: 0,
        status: 'no_amount',
        version: 1,
      });
      expect(inv.items).toEqual([]);
      expect(inv.totals.total).toBe(0);
      // No job: nothing read from or written to deal-service.
      expect(deal.getBillingView).not.toHaveBeenCalled();
      expect(deal.setInvoiceLink).not.toHaveBeenCalled();
      expect(deal.addTimeline).not.toHaveBeenCalled();
      expect(events.invoice).toHaveBeenCalledWith(BillingEventType.INVOICE_CREATED, expect.objectContaining({ number: '1001' }));
    });

    it('falls back to the company terms, then the default profile, when the client has none', async () => {
      crm.getCompany.mockResolvedValueOnce({ id: 'co-1', title: 'Acme', paymentTerms: PaymentTerms.NET_15 });
      crm.getContact.mockResolvedValueOnce({ id: 'contact-1', firstName: 'J', lastName: 'C', companyId: 'co-1', addresses: [] });
      expect(await noJob()).toMatchObject({ paymentTerms: PaymentTerms.NET_15, dueDate: '2026-10-01' });
      expect(await noJob()).toMatchObject({ paymentTerms: PaymentTerms.CASH, dueDate: '2026-09-16' });
    });

    it('404s for an unknown client and is office-only to create', async () => {
      crm.getContact.mockResolvedValueOnce(null);
      await expect(noJob()).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.createForClient('contact-1', caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('owns its lines: add, edit, toggle taxable, reorder, remove — totals and status follow', async () => {
      const inv = await noJob();
      let v = await service.addItem(inv.id, itemDto({ priceClient: 100 }), caller());
      expect(v.items).toHaveLength(1);
      expect(v.items[0]).toMatchObject({ productId: 'p-9', position: 0, amount: 100, taxable: true });
      expect(v.totals.total).toBe(100);
      expect(v.status).toBe('due');
      expect(repo.store.get(inv.id)!.totals.total).toBe(100);

      v = await service.addItem(inv.id, itemDto({ productId: 'p-10', priceClient: 50, taxable: false }), caller());
      expect(v.items.map((i) => i.position)).toEqual([0, 1]);
      expect(v.totals.subtotal).toBe(150);

      const [a, b] = v.items;
      v = await service.updateItem(inv.id, a!.lineId, itemDto({ quantity: 2, priceClient: 100 }), caller());
      expect(v.totals.subtotal).toBe(250);
      v = await service.setItemTaxable(inv.id, b!.lineId, true, caller());
      expect(v.items.find((i) => i.lineId === b!.lineId)!.taxable).toBe(true);
      v = await service.reorderItems(inv.id, [b!.lineId, a!.lineId], caller());
      expect(v.items.map((i) => i.lineId)).toEqual([b!.lineId, a!.lineId]);
      v = await service.removeItem(inv.id, a!.lineId, caller());
      expect(v.items.map((i) => i.lineId)).toEqual([b!.lineId]);
      expect(v.totals.subtotal).toBe(50);
      await expect(service.removeItem(inv.id, 'nope', caller())).rejects.toBeInstanceOf(NotFoundException);
      expect(deal.getBillingView).not.toHaveBeenCalled();
    });

    it("refuses line edits on a job invoice — its items are the job's", async () => {
      await service.create('deal-1', caller());
      await expect(service.addItem('deal-1', itemDto(), caller())).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(service.update('deal-1', { taxRateId: 'tax-1' }, caller())).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(service.update('deal-1', { discount: { type: 'percent', value: 5 } }, caller())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('sets its own tax rate and discount', async () => {
      deal.listTaxRates.mockResolvedValue([{ id: 'tax-1', name: 'CT Sales', ratePercent: 6.35, active: true }]);
      const inv = await noJob();
      await service.addItem(inv.id, itemDto({ priceClient: 100 }), caller());
      let v = await service.update(inv.id, { taxRateId: 'tax-1' }, caller());
      expect(v).toMatchObject({ taxRateId: 'tax-1', taxRateName: 'CT Sales', taxRatePercent: 6.35, taxSource: 'manual' });
      expect(v.totals.tax).toBe(6.35);
      v = await service.update(inv.id, { discount: { type: 'amount', value: 10 } }, caller());
      expect(v.totals).toMatchObject({ discount: 10, total: 95.72 });
      v = await service.update(inv.id, { taxRateId: null, discount: null }, caller());
      expect(v.taxRateId).toBeUndefined();
      expect(v.discount).toBeUndefined();
      expect(v.totals.total).toBe(100);
      await expect(service.update(inv.id, { taxRateId: 'nope' }, caller())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is office-only to read: a technician scoped to their jobs cannot see or list it', async () => {
      const inv = await noJob();
      await service.create('deal-1', caller());
      const tech = caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' });
      deal.listDealIdsByTech.mockResolvedValue(new Set(['deal-1']));
      await expect(service.get(inv.id, tech)).rejects.toBeInstanceOf(ForbiddenException);
      const page = await service.list({ limit: 20 }, tech);
      expect(page.items.map((i) => i.number)).toEqual(['K4T9ZW']);
    });

    it('derives totals and status from its own lines and the payment ledger', async () => {
      const ledger = { listByInvoice: jest.fn(async () => [] as unknown[]) };
      service = build(ledger);
      const inv = await noJob();
      await service.addItem(inv.id, itemDto({ priceClient: 100 }), caller());
      ledger.listByInvoice.mockResolvedValue([{ status: 'settled', amount: 40, refundedAmount: 0 }]);
      const partly = await service.get(inv.id, caller());
      expect(partly.totals).toMatchObject({ total: 100, amountPaid: 40, balanceDue: 60 });
      expect(partly.status).toBe('due');
      const paid = await service.applyAmountPaid(inv.id, 100);
      expect(paid).toMatchObject({ status: 'paid', totals: expect.objectContaining({ balanceDue: 0 }) });
      expect(deal.getBillingView).not.toHaveBeenCalled();
    });

    it('header edits, mark-sent and delete work without a job', async () => {
      const inv = await noJob();
      const terms = await service.update(inv.id, { paymentTerms: PaymentTerms.NET_15 }, caller());
      expect(terms.dueDate).toBe('2026-10-01');
      const dated = await service.update(inv.id, { invoiceDate: '2026-09-20' }, caller());
      expect(dated.dueDate).toBe('2026-10-05');
      const sent = await service.markSent(inv.id, true, caller());
      expect(sent.sentAt).toBe(NOW);
      await service.delete(inv.id, caller());
      expect(repo.store.has(inv.id)).toBe(false);
      expect(deal.setInvoiceLink).not.toHaveBeenCalled();
      expect(deal.addTimeline).not.toHaveBeenCalled();
      expect(deal.getBillingView).not.toHaveBeenCalled();
    });

    it('renders the PDF / HTML / portal views from the client alone, with no job view', async () => {
      const inv = await noJob();
      await service.pdf(inv.id, false, caller());
      await service.html(inv.id, caller());
      await service.portalHtml(inv.id);
      await service.portalPdf(inv.id);
      expect(deal.getBillingView).not.toHaveBeenCalled();
      const sources = [...documents.pdf.mock.calls, ...documents.html.mock.calls].map((c) => (c as unknown[])[0]);
      expect(sources).toHaveLength(4);
      for (const source of sources) {
        expect(source).toMatchObject({ kind: 'invoice', doc: expect.objectContaining({ id: inv.id, number: '1001' }) });
        expect((source as { view?: unknown }).view).toBeUndefined();
      }
    });

    it("lists a client's invoices with and without a job together", async () => {
      await noJob();
      await service.create('deal-1', caller());
      const all = await service.listForContact('contact-1');
      expect(all.map((x) => x.number).sort()).toEqual(['1001', 'K4T9ZW']);
    });
  });
});
