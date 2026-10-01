import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Estimate, Proposal } from '@bitcrm/types';
import { ProposalsService } from 'src/proposals/proposals.service';
import { NOW, caller, mockDealClient } from './mocks';

function mockRepo() {
  const rows = new Map<string, Proposal>();
  let seq = 255;
  return {
    rows,
    nextSeq: jest.fn(async () => ++seq),
    create: jest.fn(async (p: Proposal) => void rows.set(p.id, p)),
    get: jest.fn(async (id: string) => rows.get(id) ?? null),
    update: jest.fn(async (id: string, set: Partial<Proposal>, remove: string[] = []) => {
      const cur = { ...rows.get(id)!, ...set } as Record<string, unknown>;
      for (const k of remove) delete cur[k];
      cur.version = (rows.get(id)!.version ?? 0) + 1;
      rows.set(id, cur as unknown as Proposal);
      return cur as unknown as Proposal;
    }),
    listByDeal: jest.fn(async (dealId: string) => [...rows.values()].filter((p) => p.dealId === dealId)),
    listByContact: jest.fn(async (contactId: string) => [...rows.values()].filter((p) => p.contactId === contactId)),
  };
}

const est = (over: Partial<Estimate>): Estimate =>
  ({
    id: 'e1',
    number: 'K4T9ZW-1',
    dealId: 'deal-1',
    dealNumber: 'K4T9ZW',
    contactId: 'contact-1',
    status: 'unsent',
    estimateDate: '2026-09-16',
    totals: { total: 100 },
    version: 1,
    createdBy: 'u-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as Estimate;

function mockEstimates(seed: Estimate[]) {
  const rows = new Map(seed.map((e) => [e.id, e]));
  return {
    rows,
    listByDeal: jest.fn(async (dealId: string) => [...rows.values()].filter((e) => e.dealId === dealId).map((e) => ({ ...e, items: [] }))),
    getStored: jest.fn(async (id: string) => rows.get(id) ?? null),
    attachToProposal: jest.fn(async (ids: string[], proposalId: string) => {
      for (const id of ids) {
        const e = rows.get(id)!;
        rows.set(id, { ...e, proposalId, sentAt: NOW, status: e.status === 'unsent' ? 'pending' : e.status });
      }
    }),
    declineByClient: jest.fn(async (id: string, input: { reason?: string }) => {
      const e = rows.get(id)!;
      rows.set(id, { ...e, status: 'declined', declineReason: input.reason });
      return { ...rows.get(id)!, items: [] };
    }),
  };
}

describe('ProposalsService (Workiz "Send all (proposal)")', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(NOW)));
  afterEach(() => jest.useRealTimers());

  const build = (seed: Estimate[]) => {
    const repo = mockRepo();
    const estimates = mockEstimates(seed);
    const deal = mockDealClient();
    const service = new ProposalsService(repo as never, estimates as never, deal as never);
    return { repo, estimates, deal, service };
  };

  it('bundles the job’s OPEN estimates into one numbered proposal and sends them all', async () => {
    const { service, estimates, repo, deal } = build([
      est({ id: 'e1' }),
      est({ id: 'e2', number: 'K4T9ZW-2', status: 'pending', sentAt: NOW }),
      est({ id: 'e3', number: 'K4T9ZW-3', status: 'declined' }),
      est({ id: 'e4', number: 'K4T9ZW-4', status: 'won' }),
    ]);
    const p = await service.createAndSend('deal-1', caller());
    expect(p).toMatchObject({
      number: '256',
      dealId: 'deal-1',
      dealNumber: 'K4T9ZW',
      contactId: 'contact-1',
      estimateIds: ['e1', 'e2'],
      status: 'pending',
      sentAt: NOW,
      sentBy: 'u-1',
    });
    expect(estimates.attachToProposal).toHaveBeenCalledWith(['e1', 'e2'], p.id, expect.anything());
    expect(repo.create).toHaveBeenCalledWith(p);
    expect(deal.addTimeline).toHaveBeenCalledWith(
      'deal-1',
      expect.any(String),
      'u-1',
      expect.objectContaining({ proposalId: p.id, number: '256', estimateIds: ['e1', 'e2'] }),
      'dispatcher@example.com',
    );
  });

  it('an estimate already in a pending proposal is not bundled twice; nothing open ⇒ 422', async () => {
    const { service } = build([est({ id: 'e1', status: 'pending', sentAt: NOW, proposalId: 'p-old' })]);
    await expect(service.createAndSend('deal-1', caller())).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('when the client approves one option, the proposal is approved and the other options are declined (Workiz auto-decline)', async () => {
    const { service, estimates } = build([est({ id: 'e1' }), est({ id: 'e2', number: 'K4T9ZW-2' })]);
    const p = await service.createAndSend('deal-1', caller());
    estimates.rows.set('e2', { ...estimates.rows.get('e2')!, status: 'approved' });
    const after = await service.onEstimateApproved('e2');
    expect(after).toMatchObject({ id: p.id, status: 'approved', selectedEstimateId: 'e2', decidedAt: NOW });
    expect(estimates.declineByClient).toHaveBeenCalledWith('e1', { reason: 'Another option was approved' });
    expect(estimates.declineByClient).not.toHaveBeenCalledWith('e2', expect.anything());
  });

  it('an estimate outside any proposal changes nothing', async () => {
    const { service, estimates } = build([est({ id: 'solo', status: 'approved' })]);
    expect(await service.onEstimateApproved('solo')).toBeUndefined();
    expect(estimates.declineByClient).not.toHaveBeenCalled();
  });

  it('when every option is declined the proposal is declined too', async () => {
    const { service, estimates } = build([est({ id: 'e1' }), est({ id: 'e2', number: 'K4T9ZW-2' })]);
    const p = await service.createAndSend('deal-1', caller());
    estimates.rows.set('e1', { ...estimates.rows.get('e1')!, status: 'declined' });
    expect((await service.onEstimateDeclined('e1'))?.status).toBe('pending');
    estimates.rows.set('e2', { ...estimates.rows.get('e2')!, status: 'declined' });
    expect((await service.onEstimateDeclined('e2'))).toMatchObject({ id: p.id, status: 'declined', decidedAt: NOW });
  });

  it('lists a job’s proposals newest first and 404s an unknown one', async () => {
    const { service } = build([est({ id: 'e1' })]);
    const p = await service.createAndSend('deal-1', caller());
    expect((await service.listByDeal('deal-1', caller())).map((x) => x.id)).toEqual([p.id]);
    expect((await service.get(p.id, caller())).number).toBe('256');
    await expect(service.get('nope', caller())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the portal view of a proposal: its options as document summaries, the selected one marked', async () => {
    const { service, estimates } = build([est({ id: 'e1', name: 'Good' }), est({ id: 'e2', number: 'K4T9ZW-2', name: 'Better' })]);
    const p = await service.createAndSend('deal-1', caller());
    estimates.rows.set('e2', { ...estimates.rows.get('e2')!, status: 'approved' });
    await service.onEstimateApproved('e2');
    const list = await service.listForContact('contact-1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: p.id, number: '256', status: 'approved', selectedEstimateId: 'e2', estimateIds: ['e1', 'e2'] });
  });
});
