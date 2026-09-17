import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BillingEventType,
  TimelineEventType,
  type Estimate,
  type EstimateItem,
  type TaxRate,
} from '@bitcrm/types';
import { EstimatesService } from 'src/estimates/estimates.service';
import {
  DataScope,
  NOW,
  billingView,
  caller,
  dealProduct,
  mockDealClient,
  mockDocuments,
  mockEvents,
} from './mocks';

function mockRepo() {
  const estimates = new Map<string, Estimate>();
  const items = new Map<string, Map<string, EstimateItem>>();
  let seq = 0;
  const itemsOf = (id: string) => {
    if (!items.has(id)) items.set(id, new Map());
    return items.get(id)!;
  };
  return {
    estimates,
    items,
    nextSeq: jest.fn(async () => ++seq),
    create: jest.fn(async (e: Estimate, its: EstimateItem[]) => {
      estimates.set(e.id, e);
      for (const i of its) itemsOf(e.id).set(i.lineId, i);
    }),
    get: jest.fn(async (id: string) => {
      const e = estimates.get(id);
      if (!e) return null;
      return {
        estimate: e,
        items: [...itemsOf(id).values()].sort((a, b) => a.position - b.position),
      };
    }),
    getMetadata: jest.fn(async (id: string) => estimates.get(id) ?? null),
    update: jest.fn(async (id: string, set: Partial<Estimate>, remove: string[] = []) => {
      const cur = { ...estimates.get(id)!, ...set } as Record<string, unknown>;
      for (const k of remove) delete cur[k];
      for (const [k, v] of Object.entries(set)) if (v === null) delete cur[k];
      cur.version = (estimates.get(id)!.version ?? 0) + 1;
      estimates.set(id, cur as unknown as Estimate);
      return cur as unknown as Estimate;
    }),
    putItem: jest.fn(async (i: EstimateItem) => void itemsOf(i.estimateId).set(i.lineId, i)),
    deleteItem: jest.fn(async (id: string, lineId: string) => void itemsOf(id).delete(lineId)),
    setPositions: jest.fn(async (id: string, positions: Array<{ lineId: string; position: number }>) => {
      for (const p of positions) itemsOf(id).get(p.lineId)!.position = p.position;
    }),
    listByDeal: jest.fn(async (dealId: string) => [...estimates.values()].filter((e) => e.dealId === dealId)),
    list: jest.fn(async () => ({ items: [...estimates.values()] })),
    listAll: jest.fn(async () => [...estimates.values()]),
    delete: jest.fn(async (id: string) => {
      estimates.delete(id);
      items.delete(id);
    }),
    deleteCounter: jest.fn(async () => undefined),
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

describe('EstimatesService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let deal: ReturnType<typeof mockDealClient>;
  let events: ReturnType<typeof mockEvents>;
  let service: EstimatesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    repo = mockRepo();
    deal = mockDealClient();
    events = mockEvents();
    service = new EstimatesService(repo as never, deal as never, mockDocuments() as never, events as never);
  });
  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    it('numbers estimates <dealNumber>-<n> from the atomic per-job counter', async () => {
      const a = await service.create({ dealId: 'deal-1' }, caller());
      const b = await service.create({ dealId: 'deal-1', name: 'Good' }, caller());
      expect(repo.nextSeq).toHaveBeenCalledWith('deal-1');
      expect(a.number).toBe('K4T9ZW-1');
      expect(b.number).toBe('K4T9ZW-2');
      expect(b.name).toBe('Good');
      expect(a.status).toBe('unsent');
      expect(a.estimateDate).toBe('2026-09-16');
      expect(a.dealNumber).toBe('K4T9ZW');
      expect(a.contactId).toBe('contact-1');
    });

    it('snapshots the job’s tax and discount', async () => {
      deal.getBillingView.mockResolvedValueOnce(
        billingView({ discount: { type: 'percent', value: 10 }, taxSource: 'manual' }),
      );
      const e = await service.create({ dealId: 'deal-1' }, caller());
      expect(e).toMatchObject({
        taxRateId: 'tax-1',
        taxRateName: 'CT Sales',
        taxRatePercent: 6.35,
        taxSource: 'manual',
        discount: { type: 'percent', value: 10 },
      });
    });

    it('starts empty unless copyJobItems', async () => {
      const empty = await service.create({ dealId: 'deal-1' }, caller());
      expect(empty.items).toEqual([]);
      expect(empty.totals.total).toBe(0);

      deal.getBillingView.mockResolvedValueOnce(
        billingView({}, [
          dealProduct(),
          dealProduct({ productId: 'svc-1', fulfillment: 'service', taxable: false, description: 'Labor' }),
        ]),
      );
      const copied = await service.create({ dealId: 'deal-1', copyJobItems: true }, caller());
      expect(copied.items).toHaveLength(2);
      expect(copied.items[0]).toMatchObject({ productId: 'p-1', position: 0, taxable: true, quantity: 2 });
      expect(copied.items[1]).toMatchObject({
        productId: 'svc-1',
        position: 1,
        taxable: false,
        productType: 'service',
        description: 'Labor',
      });
      expect(copied.totals.subtotal).toBe(200);
    });

    it('logs ESTIMATE_CREATED and publishes estimate.created', async () => {
      await service.create({ dealId: 'deal-1' }, caller());
      expect(deal.addTimeline).toHaveBeenCalledWith(
        'deal-1',
        TimelineEventType.ESTIMATE_CREATED,
        'u-1',
        expect.objectContaining({ number: 'K4T9ZW-1' }),
        'dispatcher@example.com',
      );
      expect(events.estimate).toHaveBeenCalledWith(BillingEventType.ESTIMATE_CREATED, expect.anything());
    });

    it('404s for an unknown job and 403s for an unassigned technician', async () => {
      deal.getBillingView.mockResolvedValueOnce(null as never);
      await expect(service.create({ dealId: 'x' }, caller())).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.create({ dealId: 'deal-1' }, caller(DataScope.ASSIGNED_ONLY, { id: 'tech-9' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('items', () => {
    let id: string;
    beforeEach(async () => {
      id = (await service.create({ dealId: 'deal-1' }, caller())).id;
    });

    it('adds lines at the end, taxable by default, and recomputes totals', async () => {
      await service.addItem(id, itemDto(), caller());
      const e = await service.addItem(id, itemDto({ productId: 'p-10', priceClient: 100, taxable: false }), caller());
      expect(e.items.map((i) => i.position)).toEqual([0, 1]);
      expect(e.items[0].taxable).toBe(true);
      expect(e.totals.subtotal).toBe(300);
      expect(e.totals.tax).toBe(12.7);
      expect(repo.estimates.get(id)!.totals.total).toBe(312.7);
    });

    it('updates a line and 404s for an unknown one', async () => {
      const withItem = await service.addItem(id, itemDto(), caller());
      const lineId = withItem.items[0].lineId;
      const e = await service.updateItem(id, lineId, itemDto({ quantity: 3 }), caller());
      expect(e.items[0].quantity).toBe(3);
      expect(e.totals.subtotal).toBe(600);
      await expect(service.updateItem(id, 'nope', itemDto(), caller())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('toggles taxable', async () => {
      const lineId = (await service.addItem(id, itemDto(), caller())).items[0].lineId;
      const e = await service.setItemTaxable(id, lineId, false, caller());
      expect(e.items[0].taxable).toBe(false);
      expect(e.totals.tax).toBe(0);
    });

    it('removes a line', async () => {
      const lineId = (await service.addItem(id, itemDto(), caller())).items[0].lineId;
      const e = await service.removeItem(id, lineId, caller());
      expect(e.items).toEqual([]);
      expect(e.totals.total).toBe(0);
    });

    it('reorders lines and rejects a bad permutation', async () => {
      await service.addItem(id, itemDto({ productId: 'a' }), caller());
      await service.addItem(id, itemDto({ productId: 'b' }), caller());
      const before = await service.get(id, caller());
      const [first, second] = before.items.map((i) => i.lineId);
      const after = await service.reorderItems(id, [second, first], caller());
      expect(after.items.map((i) => i.productId)).toEqual(['b', 'a']);
      await expect(service.reorderItems(id, [first], caller())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update (tax / discount)', () => {
    let id: string;
    const rates: TaxRate[] = [
      { id: 'gst', name: 'GST', ratePercent: 5, isDefault: false, active: true, isGroup: false, componentIds: [] } as unknown as TaxRate,
      { id: 'pst', name: 'PST', ratePercent: 7, isDefault: false, active: true, isGroup: false, componentIds: [] } as unknown as TaxRate,
      { id: 'hst', name: 'GST+PST', ratePercent: 0, isDefault: false, active: true, isGroup: true, componentIds: ['gst', 'pst'] } as unknown as TaxRate,
    ];
    beforeEach(async () => {
      id = (await service.create({ dealId: 'deal-1' }, caller())).id;
      await service.addItem(id, itemDto({ priceClient: 100 }), caller());
      deal.listTaxRates.mockResolvedValue(rates);
    });

    it('resolves a picked rate’s name and effective (group) percent as manual', async () => {
      const e = await service.update(id, { taxRateId: 'hst' }, caller());
      expect(e).toMatchObject({ taxRateId: 'hst', taxRateName: 'GST+PST', taxRatePercent: 12, taxSource: 'manual' });
      expect(e.totals.tax).toBe(12);
    });

    it('404s for an unknown rate', async () => {
      await expect(service.update(id, { taxRateId: 'zzz' }, caller())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('null clears the rate (manual, no tax)', async () => {
      const e = await service.update(id, { taxRateId: null }, caller());
      expect(e.taxRateId).toBeUndefined();
      expect(e.taxRateName).toBeUndefined();
      expect(e.taxRatePercent).toBe(0);
      expect(e.taxSource).toBe('manual');
      expect(e.totals.tax).toBe(0);
    });

    it('sets and clears the discount', async () => {
      const d = await service.update(id, { discount: { type: 'amount', value: 20 } }, caller());
      expect(d.totals.discount).toBe(20);
      const c = await service.update(id, { discount: null, name: 'Better' }, caller());
      expect(c.discount).toBeUndefined();
      expect(c.totals.discount).toBe(0);
      expect(c.name).toBe('Better');
    });
  });

  describe('status + send', () => {
    let id: string;
    beforeEach(async () => {
      id = (await service.create({ dealId: 'deal-1' }, caller())).id;
    });

    it('manual status change stamps timestamps and logs it', async () => {
      const e = await service.setStatus(id, 'approved', caller());
      expect(e.status).toBe('approved');
      expect(e.approvedAt).toBe(NOW);
      expect(e.statusChangedAt).toBe(NOW);
      expect(deal.addTimeline).toHaveBeenCalledWith(
        'deal-1',
        TimelineEventType.ESTIMATE_STATUS_CHANGED,
        'u-1',
        expect.objectContaining({ from: 'unsent', to: 'approved' }),
        'dispatcher@example.com',
      );
    });

    it('mark-sent moves unsent to pending', async () => {
      const e = await service.markSent(id, true, caller());
      expect(e.status).toBe('pending');
      expect(e.sentAt).toBe(NOW);
      expect(deal.addTimeline).toHaveBeenCalledWith('deal-1', TimelineEventType.ESTIMATE_SENT, 'u-1', expect.anything(), 'dispatcher@example.com');
    });
  });

  describe('sync-to-job', () => {
    let id: string;
    beforeEach(async () => {
      id = (await service.create({ dealId: 'deal-1' }, caller())).id;
    });

    it('needs at least one item', async () => {
      await expect(service.syncToJob(id, caller())).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(deal.replaceAllProducts).not.toHaveBeenCalled();
    });

    it('is refused for archived estimates', async () => {
      await service.addItem(id, itemDto(), caller());
      await service.setStatus(id, 'archived', caller());
      await expect(service.syncToJob(id, caller())).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('replaces the job items and marks the estimate won + synced', async () => {
      await service.addItem(id, itemDto({ description: 'Wi-Fi' }), caller());
      await service.update(id, { discount: { type: 'amount', value: 5 } }, caller());
      await service.setStatus(id, 'declined', caller());
      deal.replaceAllProducts.mockResolvedValueOnce({
        items: [dealProduct(), dealProduct({ productId: 'p-2' })],
        deal: {} as never,
      });

      const res = await service.syncToJob(id, caller());

      expect(deal.replaceAllProducts).toHaveBeenCalledWith('deal-1', {
        actorId: 'u-1',
        actorName: 'dispatcher@example.com',
        estimateNumber: 'K4T9ZW-1',
        items: [
          {
            productId: 'p-9',
            name: 'Smart lock',
            sku: 'SL-9',
            description: 'Wi-Fi',
            quantity: 1,
            priceClient: 200,
            costCompany: 120,
            costForTech: 20,
            taxable: true,
          },
        ],
        taxRateId: 'tax-1',
        // The snapshot lets deal-service keep a rate id that no longer resolves.
        taxRateName: 'CT Sales',
        taxRatePercent: 6.35,
        discount: { type: 'amount', value: 5 },
      });
      expect(res.itemCount).toBe(2);
      expect(res.estimate).toMatchObject({
        status: 'won',
        wonAt: NOW,
        syncedAt: NOW,
        syncedBy: 'u-1',
      });
      expect(events.estimate).toHaveBeenCalledWith(BillingEventType.ESTIMATE_SYNCED, expect.anything());
    });

    it('does not force a tax rate onto the job for an exempt estimate', async () => {
      deal.getBillingView.mockResolvedValueOnce(
        billingView({ taxSource: 'exempt', taxRateId: undefined, taxRatePercent: undefined }),
      );
      const ex = await service.create({ dealId: 'deal-1' }, caller());
      await service.addItem(ex.id, itemDto(), caller());
      await service.syncToJob(ex.id, caller());
      const body = (deal.replaceAllProducts.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>;
      expect('taxRateId' in body).toBe(false);
    });
  });

  describe('duplicate / delete / job lifecycle', () => {
    it('duplicates with a new number, unsent, items copied', async () => {
      const src = await service.create({ dealId: 'deal-1', name: 'Best' }, caller());
      await service.addItem(src.id, itemDto(), caller());
      await service.markSent(src.id, true, caller());

      const dup = await service.duplicate(src.id, caller());
      expect(dup.id).not.toBe(src.id);
      expect(dup.number).toBe('K4T9ZW-2');
      expect(dup.status).toBe('unsent');
      expect(dup.sentAt).toBeUndefined();
      expect(dup.name).toBe('Best');
      expect(dup.items).toHaveLength(1);
      expect(dup.items[0].lineId).not.toBe((await service.get(src.id, caller())).items[0].lineId);
      expect(dup.items[0].estimateId).toBe(dup.id);
      expect(dup.totals.subtotal).toBe(200);
    });

    it('delete logs ESTIMATE_DELETED', async () => {
      const e = await service.create({ dealId: 'deal-1' }, caller());
      await service.delete(e.id, caller());
      expect(repo.estimates.has(e.id)).toBe(false);
      expect(deal.addTimeline).toHaveBeenCalledWith('deal-1', TimelineEventType.ESTIMATE_DELETED, 'u-1', expect.anything(), 'dispatcher@example.com');
    });

    it('archives the job’s open estimates when the job is canceled, keeping won ones', async () => {
      const a = await service.create({ dealId: 'deal-1' }, caller());
      const b = await service.create({ dealId: 'deal-1' }, caller());
      await service.setStatus(b.id, 'won', caller());
      const n = await service.archiveOpenForDeal('deal-1');
      expect(n).toBe(1);
      expect(repo.estimates.get(a.id)!.status).toBe('archived');
      expect(repo.estimates.get(b.id)!.status).toBe('won');
    });

    it('re-points the job’s estimates when the job moves to another client', async () => {
      const a = await service.create({ dealId: 'deal-1' }, caller());
      deal.getBillingView.mockResolvedValueOnce(billingView({ contactId: 'contact-2' }));
      events.estimate.mockClear();
      await expect(service.followDealContact('deal-1')).resolves.toBe(1);
      expect(repo.update).toHaveBeenLastCalledWith(
        a.id,
        expect.objectContaining({ contactId: 'contact-2', createdAt: a.createdAt }),
      );
      expect(repo.estimates.get(a.id)!.contactId).toBe('contact-2');
      expect(events.estimate).toHaveBeenCalledWith(BillingEventType.ESTIMATE_UPDATED, expect.anything());
      // Already in step: no writes.
      deal.getBillingView.mockResolvedValueOnce(billingView({ contactId: 'contact-2' }));
      repo.update.mockClear();
      await expect(service.followDealContact('deal-1')).resolves.toBe(0);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('does not read the job when it has no estimates', async () => {
      deal.getBillingView.mockClear();
      await expect(service.followDealContact('deal-9')).resolves.toBe(0);
      expect(deal.getBillingView).not.toHaveBeenCalled();
    });

    it('deletes all of a deleted job’s estimates', async () => {
      await service.create({ dealId: 'deal-1' }, caller());
      await service.create({ dealId: 'deal-1' }, caller());
      await service.deleteForDeal('deal-1');
      expect(repo.estimates.size).toBe(0);
      expect(repo.deleteCounter).toHaveBeenCalledWith('deal-1');
    });
  });
});
