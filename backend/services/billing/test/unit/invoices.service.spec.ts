import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BillingEventType, TimelineEventType, type Invoice } from '@bitcrm/types';
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
  return {
    store,
    create: jest.fn(async (inv: Invoice) => {
      if (store.has(inv.id)) throw new InvoiceExistsError();
      store.set(inv.id, inv);
    }),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
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
    delete: jest.fn(async (id: string) => void store.delete(id)),
    list: jest.fn(async () => ({ items: [...store.values()] })),
    listAll: jest.fn(async () => [...store.values()]),
  };
}

describe('InvoicesService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let deal: ReturnType<typeof mockDealClient>;
  let crm: ReturnType<typeof mockCrmClient>;
  let profiles: ReturnType<typeof mockProfileService>;
  let events: ReturnType<typeof mockEvents>;
  let service: InvoicesService;

  const build = () =>
    new InvoicesService(
      repo as never,
      deal as never,
      crm as never,
      profiles as never,
      mockDocuments() as never,
      events as never,
    );

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    repo = mockRepo();
    deal = mockDealClient();
    crm = mockCrmClient();
    profiles = mockProfileService();
    events = mockEvents();
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
});
