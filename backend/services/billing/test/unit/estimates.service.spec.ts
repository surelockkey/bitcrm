import {
  BadRequestException,
  ConflictException,
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
  mockCrmClient,
  mockDealClient,
  mockDocumentSettings,
  mockDocuments,
  mockEvents,
  mockSignatures,
} from './mocks';

function mockRepo() {
  const estimates = new Map<string, Estimate>();
  const items = new Map<string, Map<string, EstimateItem>>();
  let seq = 0;
  let accountSeq = 0;
  const itemsOf = (id: string) => {
    if (!items.has(id)) items.set(id, new Map());
    return items.get(id)!;
  };
  return {
    estimates,
    items,
    nextSeq: jest.fn(async () => ++seq),
    nextAccountSeq: jest.fn(async () => ++accountSeq),
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
  let crm: ReturnType<typeof mockCrmClient>;
  let documents: ReturnType<typeof mockDocuments>;
  let service: EstimatesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    repo = mockRepo();
    deal = mockDealClient();
    events = mockEvents();
    crm = mockCrmClient();
    documents = mockDocuments();
    service = new EstimatesService(
      repo as never,
      deal as never,
      documents as never,
      events as never,
      undefined,
      crm as never,
    );
  });
  afterEach(() => jest.useRealTimers());

  describe('cover image + description (Workiz proposal options)', () => {
    const assets = () => ({
      getUrl: jest.fn(async (id: string) => {
        if (id === 'asset-missing') throw new NotFoundException('Asset not found');
        return { url: `https://s3/${id}` };
      }),
    });

    it('stores the description and the cover asset, and the view carries a signed cover URL', async () => {
      const a = assets();
      const svc = new EstimatesService(repo as never, deal as never, documents as never, events as never, undefined, crm as never, undefined, undefined, a as never);
      const e = await svc.create({ dealId: 'deal-1' }, caller());
      const saved = await svc.update(e.id, { description: '  16-lite primed door, hardware reused  ', coverAssetId: 'asset-7' }, caller());
      expect(saved.description).toBe('16-lite primed door, hardware reused');
      expect(saved.coverAssetId).toBe('asset-7');
      expect(saved.coverUrl).toBe('https://s3/asset-7');
      expect((await svc.get(e.id, caller())).coverUrl).toBe('https://s3/asset-7');
      const cleared = await svc.update(e.id, { description: null, coverAssetId: null }, caller());
      expect(cleared.description).toBeUndefined();
      expect(cleared.coverAssetId).toBeUndefined();
      expect(cleared.coverUrl).toBeUndefined();
    });

    it('refuses a cover that was never uploaded', async () => {
      const svc = new EstimatesService(repo as never, deal as never, documents as never, events as never, undefined, crm as never, undefined, undefined, assets() as never);
      const e = await svc.create({ dealId: 'deal-1' }, caller());
      await expect(svc.update(e.id, { coverAssetId: 'asset-missing' }, caller())).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('copy to job (Workiz "Copy to job" on a standalone estimate)', () => {
    it('puts the estimate’s lines on the client’s job, links the estimate to it and marks it won', async () => {
      const e = await service.create({ contactId: 'contact-1' }, caller());
      await service.addItem(e.id, itemDto(), caller());
      deal.getBillingView.mockResolvedValueOnce(billingView({ id: 'deal-9', dealNumber: 'NEWJOB', contactId: 'contact-1' }));
      const { estimate, itemCount } = await service.copyToJob(e.id, 'deal-9', caller());
      expect(deal.replaceAllProducts).toHaveBeenCalledWith('deal-9', expect.objectContaining({ estimateNumber: e.number }));
      expect(estimate).toMatchObject({ dealId: 'deal-9', dealNumber: 'NEWJOB', status: 'won', syncedAt: NOW, syncedBy: 'u-1' });
      expect(itemCount).toBe(1);
      expect(deal.addTimeline).toHaveBeenCalledWith('deal-9', TimelineEventType.ESTIMATE_SYNCED, 'u-1', expect.objectContaining({ estimateId: e.id }), 'dispatcher@example.com');
    });

    it('refuses another client’s job, and a job estimate’s own job (that is Sync to job)', async () => {
      const e = await service.create({ contactId: 'contact-1' }, caller());
      await service.addItem(e.id, itemDto(), caller());
      deal.getBillingView.mockResolvedValueOnce(billingView({ id: 'deal-9', contactId: 'someone-else' }));
      await expect(service.copyToJob(e.id, 'deal-9', caller())).rejects.toBeInstanceOf(ConflictException);
      const onJob = await service.create({ dealId: 'deal-1' }, caller());
      await expect(service.copyToJob(onJob.id, 'deal-1', caller())).rejects.toBeInstanceOf(ConflictException);
      expect(deal.replaceAllProducts).not.toHaveBeenCalled();
    });
  });

  describe('copy a JOB estimate to a new job (Workiz "Create new job" under the estimate)', () => {
    const jobEstimate = async () => {
      const e = await service.create({ dealId: 'deal-1' }, caller());
      await service.addItem(e.id, itemDto(), caller());
      await service.update(e.id, { name: 'Better', depositPercentage: 50 }, caller());
      return repo.get(e.id).then((f) => f!);
    };
    const newJob = (over: Record<string, unknown> = {}) =>
      deal.getBillingView.mockResolvedValueOnce(billingView({ id: 'deal-9', dealNumber: 'NEWJOB', contactId: 'contact-1', ...over }));

    it('makes a copy on the new job and puts its lines on that job; the original estimate and its job stay as they were', async () => {
      const original = await jobEstimate();
      const before = { estimate: { ...original.estimate }, items: original.items.map((i) => ({ ...i })) };
      deal.replaceAllProducts.mockClear();
      deal.addTimeline.mockClear();
      newJob();

      const { estimate: copy, itemCount } = await service.copyToJob(original.estimate.id, 'deal-9', caller());

      expect(copy.id).not.toBe(original.estimate.id);
      // Numbered on the NEW job's counter (the fake's counter is shared, the real one is per job).
      expect(copy.number).toMatch(/^NEWJOB-\d+$/);
      expect(repo.nextSeq).toHaveBeenLastCalledWith('deal-9');
      expect(copy).toMatchObject({
        dealId: 'deal-9',
        dealNumber: 'NEWJOB',
        contactId: 'contact-1',
        name: 'Better',
        depositPercentage: 50,
        status: 'won',
        wonAt: NOW,
        syncedAt: NOW,
        syncedBy: 'u-1',
        createdBy: 'u-1',
        version: 1,
      });
      expect(copy.items).toHaveLength(1);
      expect(copy.items[0]).toMatchObject({ estimateId: copy.id, name: 'Smart lock', priceClient: 200, position: 0 });
      expect(copy.items[0].lineId).not.toBe(before.items[0].lineId);
      expect(copy.totals.total).toBe(original.estimate.totals.total);
      expect(itemCount).toBe(1);
      // Stored, under the new job.
      expect((await repo.get(copy.id))!.estimate).toMatchObject({ dealId: 'deal-9', number: copy.number });

      // Only the NEW job's items are replaced, from the copy.
      expect(deal.replaceAllProducts).toHaveBeenCalledTimes(1);
      expect(deal.replaceAllProducts).toHaveBeenCalledWith(
        'deal-9',
        expect.objectContaining({ estimateNumber: copy.number, items: [expect.objectContaining({ name: 'Smart lock', quantity: 1 })] }),
      );
      // The original is untouched.
      const after = (await repo.get(original.estimate.id))!;
      expect(after.estimate).toEqual(before.estimate);
      expect(after.items).toEqual(before.items);

      // The new job's timeline says where the estimate came from; nothing is written on the old job.
      expect(deal.addTimeline).toHaveBeenCalledTimes(1);
      expect(deal.addTimeline).toHaveBeenCalledWith(
        'deal-9',
        TimelineEventType.ESTIMATE_SYNCED,
        'u-1',
        expect.objectContaining({ estimateId: copy.id, number: copy.number, copiedFrom: original.estimate.number }),
        'dispatcher@example.com',
      );
      expect(events.estimate).toHaveBeenCalledWith(BillingEventType.ESTIMATE_CREATED, expect.objectContaining({ id: copy.id, dealId: 'deal-9' }));
    });

    it('leaves the original’s own history behind: not sent, not approved or signed, in no proposal', async () => {
      const original = await jobEstimate();
      repo.estimates.set(original.estimate.id, {
        ...original.estimate,
        status: 'approved',
        sentAt: NOW,
        sentBy: 'u-1',
        approvedAt: NOW,
        approvedVia: 'portal',
        signedAt: NOW,
        proposalId: 'prop-1',
        declineReason: 'n/a',
        workizNumber: '1041-1',
      });
      newJob();
      const { estimate: copy } = await service.copyToJob(original.estimate.id, 'deal-9', caller());
      for (const field of ['sentAt', 'sentBy', 'approvedAt', 'approvedVia', 'signedAt', 'proposalId', 'declineReason', 'workizNumber'] as const) {
        expect(copy[field]).toBeUndefined();
      }
      expect(copy.status).toBe('won');
    });

    it('refuses another client’s job and an archived or empty estimate, and writes nothing', async () => {
      const original = await jobEstimate();
      deal.replaceAllProducts.mockClear();
      newJob({ contactId: 'someone-else' });
      await expect(service.copyToJob(original.estimate.id, 'deal-9', caller())).rejects.toBeInstanceOf(ConflictException);

      const empty = await service.create({ dealId: 'deal-1' }, caller());
      newJob();
      await expect(service.copyToJob(empty.id, 'deal-9', caller())).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(deal.replaceAllProducts).not.toHaveBeenCalled();
      expect([...repo.estimates.values()].filter((e) => e.dealId === 'deal-9')).toHaveLength(0);
    });

    it('needs a technician to be on the new job as well', async () => {
      const original = await jobEstimate();
      const tech = caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' });
      // The estimate's own job (deal-1) has tech-1; the new job does not.
      deal.getBillingView.mockImplementation(async (id: string) =>
        id === 'deal-9'
          ? billingView({ id: 'deal-9', dealNumber: 'NEWJOB', contactId: 'contact-1', assignedTechIds: ['someone-else'] })
          : billingView(),
      );
      await expect(service.copyToJob(original.estimate.id, 'deal-9', tech)).rejects.toBeInstanceOf(ForbiddenException);
      expect([...repo.estimates.values()].filter((e) => e.dealId === 'deal-9')).toHaveLength(0);
    });
  });

  describe('deposit', () => {
    it('a percent of the total OR a fixed amount, never both; null clears', async () => {
      const e = await service.create({ dealId: 'deal-1' }, caller());
      const pct = await service.update(e.id, { depositPercentage: 50 }, caller());
      expect(pct.depositPercentage).toBe(50);
      expect(pct.depositAmount).toBeUndefined();
      const amt = await service.update(e.id, { depositAmount: 75 }, caller());
      expect(amt.depositAmount).toBe(75);
      expect(amt.depositPercentage).toBeUndefined();
      const none = await service.update(e.id, { depositAmount: null }, caller());
      expect(none.depositAmount).toBeUndefined();
      expect(none.depositPercentage).toBeUndefined();
    });

    it('refuses a percent over 100, a negative amount, or both at once', async () => {
      const e = await service.create({ dealId: 'deal-1' }, caller());
      await expect(service.update(e.id, { depositPercentage: 101 }, caller())).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update(e.id, { depositAmount: -5 }, caller())).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update(e.id, { depositPercentage: 10, depositAmount: 10 }, caller())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('client approval (portal)', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    let signatures: ReturnType<typeof mockSignatures>;
    let withSignatures: EstimatesService;

    beforeEach(() => {
      signatures = mockSignatures();
      withSignatures = new EstimatesService(
        repo as never,
        deal as never,
        documents as never,
        events as never,
        undefined,
        crm as never,
        undefined,
        signatures as never,
      );
    });

    const sentEstimate = async () => {
      const e = await withSignatures.create({ dealId: 'deal-1' }, caller());
      await withSignatures.addItem(e.id, itemDto(), caller());
      await withSignatures.markSent(e.id, true, caller());
      return e.id;
    };

    it('approving signs first: the signature is stored, then the status becomes approved', async () => {
      const id = await sentEstimate();
      const approved = await withSignatures.approveByClient(id, { imageDataUrl: PNG, signedBy: 'Jane Client', ip: '1.2.3.4' });
      expect(signatures.collect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'estimate', documentId: id, dealId: 'deal-1', contactId: 'contact-1', signedBy: 'Jane Client', source: 'portal', ip: '1.2.3.4' }),
      );
      expect(approved.status).toBe('approved');
      expect(approved.approvedAt).toBe(NOW);
      expect(approved.approvedVia).toBe('portal');
      expect(approved.signedAt).toBe(NOW);
      expect(deal.addTimeline).toHaveBeenCalledWith(
        'deal-1',
        TimelineEventType.ESTIMATE_APPROVED,
        'client',
        expect.objectContaining({ estimateId: id, signedBy: 'Jane Client' }),
        'Jane Client',
      );
      expect(events.estimate).toHaveBeenCalledWith(BillingEventType.ESTIMATE_UPDATED, expect.objectContaining({ status: 'approved' }));
    });

    describe('auto-decline estimates related to the same job (Settings → Estimates)', () => {
      const PNG2 = 'data:image/png;base64,iVBORw0KGgo=';
      const build = (autoDeclineSameJob: boolean) => {
        const estimateSettings = { get: jest.fn(async () => ({ attachPdf: true, autoDeclineSameJob })) };
        const svc = new EstimatesService(
          repo as never,
          deal as never,
          documents as never,
          events as never,
          undefined,
          crm as never,
          undefined,
          signatures as never,
          undefined,
          undefined,
          estimateSettings as never,
        );
        return { svc, estimateSettings };
      };
      /** The job's estimates: a sent one (the client approves this), an unsent, a pending, a declined, a won; plus another job's. */
      const jobWithSiblings = async (svc: EstimatesService) => {
        const chosen = await svc.create({ dealId: 'deal-1' }, caller());
        await svc.addItem(chosen.id, itemDto(), caller());
        await svc.markSent(chosen.id, true, caller());
        const unsent = await svc.create({ dealId: 'deal-1' }, caller());
        const pending = await svc.create({ dealId: 'deal-1' }, caller());
        await svc.markSent(pending.id, true, caller());
        const declined = await svc.create({ dealId: 'deal-1' }, caller());
        await svc.setStatus(declined.id, 'declined', caller());
        const won = await svc.create({ dealId: 'deal-1' }, caller());
        await svc.setStatus(won.id, 'won', caller());
        deal.getBillingView.mockResolvedValueOnce(billingView({ id: 'deal-2', dealNumber: 'ZZ9999' }));
        const other = await svc.create({ dealId: 'deal-2' }, caller());
        deal.addTimeline.mockClear();
        events.estimate.mockClear();
        return { chosen, unsent, pending, declined, won, other };
      };

      it('the client approving one estimate declines the job’s other OPEN estimates, with Workiz’s timeline line', async () => {
        const { svc } = build(true);
        const s = await jobWithSiblings(svc);
        await svc.approveByClient(s.chosen.id, { imageDataUrl: PNG2, signedBy: 'Jane Client' });
        expect(repo.estimates.get(s.chosen.id)!.status).toBe('approved');
        for (const id of [s.unsent.id, s.pending.id]) {
          const e = repo.estimates.get(id)!;
          expect(e.status).toBe('declined');
          expect(e.declinedAt).toBe(NOW);
          expect(e.declineReason).toBe(`Another estimate for this job was approved (${s.chosen.number})`);
        }
        expect(repo.estimates.get(s.declined.id)!.declineReason).toBeUndefined();
        expect(repo.estimates.get(s.won.id)!.status).toBe('won');
        expect(repo.estimates.get(s.other.id)!.status).toBe('unsent');
        // "Updated estimate K4T9ZW-2 status to Declined" — as Workiz words it; the client is the actor.
        expect(deal.addTimeline).toHaveBeenCalledWith(
          'deal-1',
          TimelineEventType.ESTIMATE_STATUS_CHANGED,
          'client',
          { estimateId: s.unsent.id, number: s.unsent.number, from: 'unsent', to: 'declined', approvedEstimateId: s.chosen.id },
          'Jane Client',
        );
        expect(deal.addTimeline).toHaveBeenCalledWith(
          'deal-1',
          TimelineEventType.ESTIMATE_STATUS_CHANGED,
          'client',
          expect.objectContaining({ estimateId: s.pending.id, from: 'pending', to: 'declined' }),
          'Jane Client',
        );
        expect(events.estimate).toHaveBeenCalledWith(
          BillingEventType.ESTIMATE_UPDATED,
          expect.objectContaining({ id: s.pending.id, status: 'declined' }),
        );
      });

      it('the office approving one estimate does the same, as the user who approved', async () => {
        const { svc } = build(true);
        const s = await jobWithSiblings(svc);
        await svc.setStatus(s.chosen.id, 'approved', caller());
        expect(repo.estimates.get(s.unsent.id)!.status).toBe('declined');
        expect(repo.estimates.get(s.pending.id)!.status).toBe('declined');
        expect(repo.estimates.get(s.won.id)!.status).toBe('won');
        expect(deal.addTimeline).toHaveBeenCalledWith(
          'deal-1',
          TimelineEventType.ESTIMATE_STATUS_CHANGED,
          'u-1',
          expect.objectContaining({ estimateId: s.unsent.id, to: 'declined' }),
          'dispatcher@example.com',
        );
        // Approving it again (no change) declines nothing more.
        deal.addTimeline.mockClear();
        await svc.setStatus(s.chosen.id, 'approved', caller());
        expect(deal.addTimeline).not.toHaveBeenCalled();
      });

      it('with the switch off the other estimates stay as they were', async () => {
        const { svc, estimateSettings } = build(false);
        const s = await jobWithSiblings(svc);
        await svc.approveByClient(s.chosen.id, { imageDataUrl: PNG2, signedBy: 'Jane Client' });
        expect(estimateSettings.get).toHaveBeenCalled();
        expect(repo.estimates.get(s.unsent.id)!.status).toBe('unsent');
        expect(repo.estimates.get(s.pending.id)!.status).toBe('pending');
        expect(deal.addTimeline).not.toHaveBeenCalledWith(
          'deal-1',
          TimelineEventType.ESTIMATE_STATUS_CHANGED,
          expect.anything(),
          expect.objectContaining({ to: 'declined' }),
          expect.anything(),
        );
      });

      it('a sibling that cannot be written never fails the approval; the rest are still declined', async () => {
        const { svc } = build(true);
        const s = await jobWithSiblings(svc);
        const realUpdate = repo.update.getMockImplementation()!;
        repo.update.mockImplementation(async (id: string, ...rest: unknown[]) => {
          if (id === s.unsent.id) throw new Error('DynamoDB down');
          return (realUpdate as (...a: unknown[]) => Promise<Estimate>)(id, ...rest);
        });
        const approved = await svc.setStatus(s.chosen.id, 'approved', caller());
        expect(approved.status).toBe('approved');
        expect(repo.estimates.get(s.pending.id)!.status).toBe('declined');
        expect(repo.estimates.get(s.unsent.id)!.status).toBe('unsent');
      });

      it('a client estimate (no job) has no siblings to decline', async () => {
        const { svc } = build(true);
        const e = await svc.create({ contactId: 'contact-1' }, caller());
        await svc.addItem(e.id, itemDto(), caller());
        await svc.markSent(e.id, true, caller());
        await svc.approveByClient(e.id, { imageDataUrl: PNG2, signedBy: 'Jane Client' });
        expect(repo.listByDeal).not.toHaveBeenCalled();
      });
    });

    it('a client cannot approve an estimate that was never sent, or one already decided', async () => {
      const unsent = await withSignatures.create({ dealId: 'deal-1' }, caller());
      await expect(
        withSignatures.approveByClient(unsent.id, { imageDataUrl: PNG, signedBy: 'J' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      const id = await sentEstimate();
      await withSignatures.setStatus(id, 'declined', caller());
      await expect(withSignatures.approveByClient(id, { imageDataUrl: PNG, signedBy: 'J' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(signatures.collect).not.toHaveBeenCalled();
    });

    it('declining records the reason and the timeline, without a signature', async () => {
      const id = await sentEstimate();
      const declined = await withSignatures.declineByClient(id, { reason: 'Too expensive' });
      expect(declined.status).toBe('declined');
      expect(declined.declineReason).toBe('Too expensive');
      expect(declined.declinedAt).toBe(NOW);
      expect(signatures.collect).not.toHaveBeenCalled();
      expect(deal.addTimeline).toHaveBeenCalledWith(
        'deal-1',
        TimelineEventType.ESTIMATE_DECLINED,
        'client',
        expect.objectContaining({ estimateId: id, reason: 'Too expensive' }),
        undefined,
      );
    });

    it('an in-person signature (mobile app) is collected by the staff user and does not change the status', async () => {
      const id = await sentEstimate();
      const e = await withSignatures.sign(id, { imageDataUrl: PNG, signedBy: 'Jane Client' }, caller(DataScope.ALL, { id: 'tech-7' }));
      expect(signatures.collect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'estimate', documentId: id, source: 'app', collectedBy: 'tech-7' }),
      );
      expect(e.status).toBe('pending');
      expect(e.signatures).toHaveLength(1);
      expect(e.signedAt).toBe(NOW);
    });

    it('get() carries the document’s signatures', async () => {
      const id = await sentEstimate();
      await withSignatures.sign(id, { imageDataUrl: PNG, signedBy: 'Jane Client' }, caller());
      const e = await withSignatures.get(id, caller());
      expect(e.signatures?.[0]).toMatchObject({ signedBy: 'Jane Client', imageUrl: expect.any(String) });
    });
  });

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

    it('pre-fills Notes and the default deposit from the document settings (Workiz)', async () => {
      const withSettings = new EstimatesService(
        repo as never,
        deal as never,
        documents as never,
        events as never,
        undefined,
        crm as never,
        mockDocumentSettings({ depositPercentage: 50 }) as never,
      );
      const job = await withSettings.create({ dealId: 'deal-1' }, caller());
      expect(job.notes).toBe('Thank you for considering our services!');
      expect(job.depositPercentage).toBe(50);
      expect(job.depositAmount).toBeUndefined();
      const client = await withSettings.create({ contactId: 'contact-1' }, caller());
      expect(client.notes).toBe('Thank you for considering our services!');
      expect(client.depositPercentage).toBe(50);
    });

    it('an empty default leaves Notes and the deposit unset', async () => {
      const withSettings = new EstimatesService(
        repo as never,
        deal as never,
        documents as never,
        events as never,
        undefined,
        crm as never,
        mockDocumentSettings({ estimateNotes: '' }) as never,
      );
      const e = await withSettings.create({ dealId: 'deal-1' }, caller());
      expect(e.notes).toBeUndefined();
      expect(e.depositPercentage).toBeUndefined();
      expect(e.depositAmount).toBeUndefined();
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

  describe('Advanced (what the client sees)', () => {
    it('column choices are kept on the estimate and cleared with null', async () => {
      const e = await service.create({ dealId: 'deal-1' }, caller());
      const hidden = await service.update(e.id, { display: { unitPrice: false, lineAmount: false } }, caller());
      expect(hidden.display).toEqual({ unitPrice: false, lineAmount: false });
      const shown = await service.update(e.id, { display: null }, caller());
      expect(shown.display).toBeUndefined();
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

    it('Add to existing job items: asks deal-service to append, without touching the job’s tax or discount', async () => {
      await service.addItem(id, itemDto(), caller());
      await service.update(id, { discount: { type: 'amount', value: 5 } }, caller());
      deal.replaceAllProducts.mockResolvedValueOnce({ items: [dealProduct(), dealProduct({ productId: 'p-2' })], deal: {} as never });

      const res = await service.syncToJob(id, caller(), 'append');

      const body = (deal.replaceAllProducts.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>;
      expect(body).toMatchObject({ mode: 'append', estimateNumber: 'K4T9ZW-1', items: [expect.objectContaining({ productId: 'p-9' })] });
      expect('taxRateId' in body).toBe(false);
      expect('discount' in body).toBe(false);
      expect(res.estimate).toMatchObject({ status: 'won', syncedAt: NOW });
    });

    it('replace stays the default and says so', async () => {
      await service.addItem(id, itemDto(), caller());
      await service.syncToJob(id, caller());
      const body = (deal.replaceAllProducts.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>;
      expect('mode' in body).toBe(false);
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

  /**
   * Workiz: a client's card has Create new → Estimate, which makes an estimate
   * for the client with no job ("stub"). It is numbered from the account
   * counter, carries the client's company and tax status, and every document
   * action works without a job — except Sync to job, which has no job to go to.
   */
  describe('client estimates (no job)', () => {
    const noJob = () => service.create({ contactId: 'contact-1' }, caller());

    it('needs a job or a client', async () => {
      await expect(service.create({}, caller())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates for the client with a stub number from the account counter, no job fields, empty items', async () => {
      crm.getContact.mockResolvedValueOnce({
        id: 'contact-1',
        firstName: 'Jane',
        lastName: 'Client',
        companyId: 'co-9',
        taxExempt: true,
        addresses: [],
      });
      const e = await noJob();
      expect(repo.nextAccountSeq).toHaveBeenCalledTimes(1);
      expect(repo.nextSeq).not.toHaveBeenCalled();
      expect(e.number).toBe('1001');
      expect(e.dealId).toBeUndefined();
      expect(e.dealNumber).toBeUndefined();
      expect(e).toMatchObject({
        contactId: 'contact-1',
        companyId: 'co-9',
        taxSource: 'exempt',
        status: 'unsent',
        estimateDate: '2026-09-16',
      });
      expect(e.items).toEqual([]);
      expect(e.totals.total).toBe(0);
      // No job: nothing to read from deal-service, no job timeline to write to.
      expect(deal.getBillingView).not.toHaveBeenCalled();
      expect(deal.addTimeline).not.toHaveBeenCalled();
      expect(events.estimate).toHaveBeenCalledWith(
        BillingEventType.ESTIMATE_CREATED,
        expect.objectContaining({ number: '1001' }),
      );
      const second = await noJob();
      expect(second.number).toBe('1002');
    });

    it('404s for an unknown client', async () => {
      crm.getContact.mockResolvedValueOnce(null);
      await expect(noJob()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('takes its number from Settings → Numbering (the estimate counter) when the numbering service is wired', async () => {
      const numbering = { nextNumber: jest.fn(async (kind: string): Promise<string> => (kind === 'estimate' ? '1142' : '85427')) };
      const withNumbering = new EstimatesService(
        repo as never,
        deal as never,
        documents as never,
        events as never,
        undefined,
        crm as never,
        undefined,
        undefined,
        undefined,
        numbering as never,
      );
      const e = await withNumbering.create({ contactId: 'contact-1' }, caller());
      expect(e.number).toBe('1142');
      expect(numbering.nextNumber).toHaveBeenCalledWith('estimate');
      expect(repo.nextAccountSeq).not.toHaveBeenCalled();
      // A duplicate of a client estimate is numbered the same way; a job's stays `<job>-<n>`.
      numbering.nextNumber.mockResolvedValueOnce('1143');
      expect((await withNumbering.duplicate(e.id, caller())).number).toBe('1143');
      const job = await withNumbering.create({ dealId: 'deal-1' }, caller());
      expect(job.number).toBe('K4T9ZW-1');
      expect(numbering.nextNumber).toHaveBeenCalledTimes(2);
    });

    it('is office-only: a technician scoped to their jobs cannot see, list or count it', async () => {
      const e = await noJob();
      await service.create({ dealId: 'deal-1' }, caller());
      const tech = caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' });
      deal.listDealIdsByTech.mockResolvedValue(new Set(['deal-1']));
      await expect(service.get(e.id, tech)).rejects.toBeInstanceOf(ForbiddenException);
      const page = await service.list({}, tech);
      expect(page.items.map((i) => i.number)).toEqual(['K4T9ZW-1']);
      const summary = await service.summary(tech);
      expect(summary.total.count).toBe(1);
    });

    it('edits, items, status, mark-sent, duplicate and delete work without a job (and write no job timeline)', async () => {
      const e = await noJob();
      await service.addItem(e.id, itemDto({ priceClient: 100 }), caller());
      const updated = await service.update(e.id, { name: 'Rekey', estimateDate: '2026-09-20' }, caller());
      expect(updated).toMatchObject({ name: 'Rekey', estimateDate: '2026-09-20' });
      expect(updated.totals.subtotal).toBe(100);
      const sent = await service.markSent(e.id, true, caller());
      expect(sent.status).toBe('pending');
      const approved = await service.setStatus(e.id, 'approved', caller());
      expect(approved.approvedAt).toBe(NOW);
      const copy = await service.duplicate(e.id, caller());
      expect(copy.number).toBe('1002');
      expect(copy.dealId).toBeUndefined();
      expect(copy.items).toHaveLength(1);
      await service.delete(e.id, caller());
      expect(repo.estimates.has(e.id)).toBe(false);
      expect(deal.addTimeline).not.toHaveBeenCalled();
      expect(deal.getBillingView).not.toHaveBeenCalled();
    });

    it('renders the PDF / HTML / portal views from the client alone, with no job view', async () => {
      const e = await noJob();
      await service.pdf(e.id, false, caller());
      await service.html(e.id, caller());
      await service.portalHtml(e.id);
      await service.portalPdf(e.id);
      expect(deal.getBillingView).not.toHaveBeenCalled();
      const sources = [...documents.pdf.mock.calls, ...documents.html.mock.calls].map((c) => (c as unknown[])[0]);
      expect(sources).toHaveLength(4);
      for (const source of sources) {
        expect(source).toMatchObject({ kind: 'estimate', doc: expect.objectContaining({ id: e.id }) });
        expect((source as { view?: unknown }).view).toBeUndefined();
      }
    });

    it('sync-to-job is refused with 409: there is no job to sync to', async () => {
      const e = await noJob();
      await service.addItem(e.id, itemDto(), caller());
      await expect(service.syncToJob(e.id, caller())).rejects.toBeInstanceOf(ConflictException);
      expect(deal.replaceAllProducts).not.toHaveBeenCalled();
      expect(repo.estimates.get(e.id)!.status).toBe('unsent');
    });

    it("lists a client's estimates with and without a job together", async () => {
      await noJob();
      await service.create({ dealId: 'deal-1' }, caller());
      const all = await service.listForContact('contact-1');
      expect(all.map((x) => x.number).sort()).toEqual(['1001', 'K4T9ZW-1']);
      // The portal pages the inbox itself: a client with hundreds of documents still sees all of them.
      expect(repo.list).toHaveBeenLastCalledWith({ contactId: 'contact-1', limit: 1000 });
    });
  });
});
