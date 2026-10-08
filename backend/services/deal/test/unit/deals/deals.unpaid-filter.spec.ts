/**
 * Workiz's "Show unpaid jobs" checkbox on the jobs list: only the jobs that
 * still have money owed on them. `GET /deals?unpaid=true` (and the tab counts
 * with the same flag) answer it from what the job row already carries — no
 * scan, no call into billing:
 *
 *  - `totals.total`  what the job is worth, refreshed on every line/tax/discount change;
 *  - `amountPaid`    what billing's ledger says was collected, asserted on every ledger change;
 *  - `paymentStatus` billing's flag — and, on an imported job, Workiz's own.
 *
 * A job owes money when its total is above zero and: the ledger has spoken
 * and the total is above what was paid; or, on an imported job it has not,
 * Workiz's own amount due is above zero; or, failing both, the job is not
 * marked paid. A job paid in full and then given another line owes again.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JobSuperStatus, type Deal } from '@bitcrm/types';
import { ListDealsQueryDto } from 'src/deals/dto/list-deals-query.dto';
import { DealsService } from 'src/deals/deals.service';
import { DealsRepository } from 'src/deals/deals.repository';
import { hasBalanceDue } from 'src/deals/deal-balance';
import {
  createMockDeal,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockDynamoDbService,
  createMockJwtUser,
} from '../mocks';

const totals = (total: number) => ({ subtotal: total, discount: 0, tax: 0, total, cost: 0 });

/** Every shape a job's money can be in, and whether Workiz would list it as unpaid. */
const cases: { name: string; deal: Partial<Deal>; owes: boolean }[] = [
  { name: 'priced, nothing paid, no ledger yet', deal: { totals: totals(100) }, owes: true },
  { name: 'paid in full', deal: { totals: totals(100), amountPaid: 100, paymentStatus: 'paid' }, owes: false },
  { name: 'overpaid (tip)', deal: { totals: totals(100), amountPaid: 120, paymentStatus: 'paid' }, owes: false },
  { name: 'partly paid', deal: { totals: totals(100), amountPaid: 40, paymentStatus: 'partial' }, owes: true },
  {
    name: 'paid, then another line was added (the flag is stale, the sums are not)',
    deal: { totals: totals(150), amountPaid: 100, paymentStatus: 'paid' },
    owes: true,
  },
  { name: 'refunded back to nothing', deal: { totals: totals(100), amountPaid: 0, paymentStatus: 'unpaid' }, owes: true },
  {
    name: "imported, Workiz's own amount due is what counts — even under an 'unpaid' flag",
    deal: { totals: { ...totals(100), amountDue: 0 }, paymentStatus: 'unpaid' },
    owes: false,
  },
  { name: 'imported, Workiz amount due left', deal: { totals: { ...totals(100), amountDue: 40 }, paymentStatus: 'partial' }, owes: true },
  {
    name: 'imported, then paid here: the ledger outranks the frozen Workiz figure',
    deal: { totals: { ...totals(100), amountDue: 100 }, amountPaid: 100, paymentStatus: 'paid' },
    owes: false,
  },
  { name: 'imported, Workiz says paid', deal: { totals: totals(100), paymentStatus: 'paid' }, owes: false },
  { name: 'imported, Workiz says partial', deal: { totals: totals(100), paymentStatus: 'partial' }, owes: true },
  { name: 'imported, Workiz says unpaid', deal: { totals: totals(100), paymentStatus: 'unpaid' }, owes: true },
  { name: 'a $0 job', deal: { totals: totals(0) }, owes: false },
  { name: 'never priced (no totals)', deal: {}, owes: false },
];

describe('hasBalanceDue', () => {
  it.each(cases)('$name → $owes', ({ deal, owes }) => {
    expect(hasBalanceDue(createMockDeal(deal))).toBe(owes);
  });
});

describe('unpaid=true on the list query', () => {
  it('is a valid query param', async () => {
    const errors = await validate(plainToInstance(ListDealsQueryDto, { unpaid: 'true' }));
    expect(errors).toEqual([]);
  });

  function serviceWith(repo: ReturnType<typeof createMockDealsRepository>, cache = createMockDealsCacheService()) {
    const stub = {} as any;
    return new DealsService(repo as any, cache as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub);
  }

  it('travels to the repository as a filter, on the schedule index the jobs page reads', async () => {
    const repo = createMockDealsRepository();
    repo.findBySchedule.mockResolvedValue({ items: [], nextCursor: undefined });

    await serviceWith(repo).list(
      { superStatus: JobSuperStatus.SUBMITTED, sort: 'schedule', unpaid: 'true' } as any,
      createMockJwtUser({ id: 'd' }),
    );

    expect(repo.findBySchedule).toHaveBeenCalledWith(
      [JobSuperStatus.SUBMITTED],
      expect.anything(),
      expect.any(Number),
      undefined,
      expect.objectContaining({ unpaid: true }),
      'asc',
    );
  });

  it('is off unless asked for', async () => {
    const repo = createMockDealsRepository();
    repo.findBySuperStatus.mockResolvedValue({ items: [], nextCursor: undefined });

    await serviceWith(repo).list({ superStatus: JobSuperStatus.SUBMITTED, unpaid: 'false' } as any, createMockJwtUser({ id: 'd' }));

    expect(repo.findBySuperStatus.mock.calls[0][3].unpaid).toBeUndefined();
  });

  it('narrows the tab counts the same way', async () => {
    const repo = createMockDealsRepository();
    const cache = createMockDealsCacheService() as ReturnType<typeof createMockDealsCacheService> & {
      getJson: jest.Mock;
      setJson: jest.Mock;
    };
    cache.getJson = jest.fn().mockResolvedValue(null);
    cache.setJson = jest.fn();
    repo.countBySchedule.mockResolvedValue(0);

    await serviceWith(repo, cache).counts({ unpaid: 'true' } as any, createMockJwtUser({ id: 'd' }));

    for (const call of repo.countBySchedule.mock.calls) expect(call[2]).toEqual(expect.objectContaining({ unpaid: true }));
  });

  it('holds on a Job ID search too', async () => {
    const repo = createMockDealsRepository();
    repo.findIdByNumber.mockResolvedValue('d1');
    repo.findByIds.mockResolvedValue([createMockDeal({ id: 'd1', totals: totals(100), amountPaid: 100, paymentStatus: 'paid' })]);

    const page = await serviceWith(repo).list({ search: 'K4T9ZW', unpaid: 'true' } as any, createMockJwtUser({ id: 'd' }));

    expect(page.items).toEqual([]);
  });
});

describe('DealsRepository — the unpaid filter', () => {
  it('is one FilterExpression over the row’s own money attributes', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.findBySuperStatus(JobSuperStatus.SUBMITTED, 20, undefined, { unpaid: true });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('#totals.#total > :noMoney');
    expect(input.FilterExpression).toContain('#totals.#total > #amountPaid');
    expect(input.FilterExpression).toContain('#totals.#amountDue > :noMoney');
    expect(input.FilterExpression).toContain('#paymentStatus <> :paidStatus');
    expect(input.ExpressionAttributeNames).toMatchObject({
      '#totals': 'totals',
      '#total': 'total',
      '#amountDue': 'amountDue',
      '#amountPaid': 'amountPaid',
      '#paymentStatus': 'paymentStatus',
    });
    expect(input.ExpressionAttributeValues).toMatchObject({ ':noMoney': 0, ':paidStatus': 'paid' });
  });

  it('is honoured by the in-memory matcher the tech index uses', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    const table = (repository as any).tableName as string;
    const row = (d: Partial<Deal> & { id: string }) => ({ ...createMockDeal(d), PK: `DEAL#${d.id}`, SK: 'METADATA' });
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ dealId: 'owes' }, { dealId: 'paid' }] })
      .mockResolvedValueOnce({
        Responses: {
          [table]: [
            row({ id: 'owes', totals: totals(150), amountPaid: 100 }),
            row({ id: 'paid', totals: totals(100), amountPaid: 100, paymentStatus: 'paid' }),
          ],
        },
      });

    const page = await repository.findByTech('t1', 20, undefined, { unpaid: true });

    expect(page.items.map((d) => d.id)).toEqual(['owes']);
  });

  it('toDeal reads amountPaid back', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({
      Item: { ...createMockDeal({ id: 'd1' }), PK: 'DEAL#d1', SK: 'METADATA', amountPaid: 60 },
    });

    expect((await repository.findById('d1'))?.amountPaid).toBe(60);
  });
});
