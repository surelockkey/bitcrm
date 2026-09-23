/**
 * A Job ID lookup is one GetItem on the `DEALNUM#<code>` reservation, not a
 * scan with a filter: after the import a scan is 1.36 M rows for one code.
 * The reservation carries the deal's id from the moment the deal is created;
 * a row written before that (or an old sequential number) falls back to the
 * filtered read it always had.
 */
import { JobSuperStatus } from '@bitcrm/types';
import { DealsService } from '../../../src/deals/deals.service';
import { DealsRepository } from '../../../src/deals/deals.repository';
import { isDealNumberCode } from '../../../src/deals/deal-number.util';
import { createMockDeal, createMockDealsRepository, createMockDynamoDbService, createMockJwtUser } from '../mocks';

function serviceWith(repo: ReturnType<typeof createMockDealsRepository>): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

describe('isDealNumberCode — every six-character Workiz code counts', () => {
  it('letters and digits, letters only, digits only', () => {
    expect(isDealNumberCode('862N5B')).toBe(true);
    expect(isDealNumberCode('PFLXHM')).toBe(true);
    expect(isDealNumberCode('038072')).toBe(true);
    expect(isDealNumberCode('pflxhm')).toBe(true);
  });
  it('anything else is not a code', () => {
    expect(isDealNumberCode('1042')).toBe(false);
    expect(isDealNumberCode('ABC-123')).toBe(false);
    expect(isDealNumberCode('Smith')).toBe(false);
  });
});

describe('DealsRepository — the reservation knows its deal', () => {
  it('reserveDealNumber writes the deal id onto the reservation row', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({});
    const code = await repository.reserveDealNumber('deal-1');
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe(`DEALNUM#${code}`);
    expect(item.dealId).toBe('deal-1');
  });

  it('findIdByNumber answers the id, null for an unknown code, undefined for a legacy row', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send
      .mockResolvedValueOnce({ Item: { PK: 'DEALNUM#862N5B', SK: 'UNIQUE', dealId: 'deal-1' } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: { PK: 'DEALNUM#OLDOLD', SK: 'UNIQUE' } });
    expect(await repository.findIdByNumber('862n5b')).toBe('deal-1');
    expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({ PK: 'DEALNUM#862N5B', SK: 'UNIQUE' });
    expect(await repository.findIdByNumber('NOPE00')).toBeNull();
    expect(await repository.findIdByNumber('OLDOLD')).toBeUndefined();
  });
});

describe('DealsService.list — a Job ID search', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  const caller = createMockJwtUser({ id: 'disp-1' });

  beforeEach(() => {
    repo = createMockDealsRepository();
    (repo as any).findIdByNumber = jest.fn();
    (repo as any).findByIds = jest.fn();
    (repo as any).findBySchedule = jest.fn();
    for (const fn of ['findBySuperStatus', 'findByTech', 'findByContact', 'findByDispatcher', 'findAll']) {
      (repo as any)[fn].mockResolvedValue({ items: [], nextCursor: undefined });
    }
  });

  it('a known code is one lookup, then the deal, without touching any index', async () => {
    (repo as any).findIdByNumber.mockResolvedValue('deal-1');
    (repo as any).findByIds.mockResolvedValue([createMockDeal({ id: 'deal-1', dealNumber: '862N5B', superStatus: JobSuperStatus.DONE })]);
    const result = await serviceWith(repo).list({ search: '#862n5b' } as any, caller);
    expect(result.items.map((d) => d.id)).toEqual(['deal-1']);
    expect(result.nextCursor).toBeUndefined();
    expect(repo.findAll).not.toHaveBeenCalled();
    expect(repo.findBySuperStatus).not.toHaveBeenCalled();
  });

  it('the found deal still has to match the tab and the filters it was searched under', async () => {
    (repo as any).findIdByNumber.mockResolvedValue('deal-1');
    (repo as any).findByIds.mockResolvedValue([createMockDeal({ id: 'deal-1', superStatus: JobSuperStatus.DONE, assignedTechIds: ['t1'] })]);
    const service = serviceWith(repo);
    expect((await service.list({ search: '862N5B', superStatus: JobSuperStatus.SUBMITTED } as any, caller)).items).toEqual([]);
    expect((await service.list({ search: '862N5B', superStatus: JobSuperStatus.DONE } as any, caller)).items).toHaveLength(1);
    expect((await service.list({ search: '862N5B' } as any, createMockJwtUser({ id: 't9' }), 'assigned_only')).items).toEqual([]);
  });

  it('an unknown code is an empty page, not a scan', async () => {
    (repo as any).findIdByNumber.mockResolvedValue(null);
    const result = await serviceWith(repo).list({ search: 'NOPE00' } as any, caller);
    expect(result.items).toEqual([]);
    expect(repo.findAll).not.toHaveBeenCalled();
  });

  it('a legacy reservation without an id falls back to the filtered read', async () => {
    (repo as any).findIdByNumber.mockResolvedValue(undefined);
    await serviceWith(repo).list({ search: 'OLDOLD', superStatus: JobSuperStatus.SUBMITTED } as any, caller);
    expect(repo.findBySuperStatus).toHaveBeenCalledWith(
      JobSuperStatus.SUBMITTED,
      20,
      undefined,
      expect.objectContaining({ dealNumber: 'OLDOLD' }),
    );
  });

  it('an old sequential number never had a reservation and keeps the filtered read', async () => {
    await serviceWith(repo).list({ search: '1042' } as any, caller);
    expect((repo as any).findIdByNumber).not.toHaveBeenCalled();
    expect(repo.findAll).toHaveBeenCalledWith(20, undefined, expect.objectContaining({ dealNumber: 1042 }));
  });
});
