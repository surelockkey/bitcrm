/**
 * `POST /deals/by-ids` — hydrate a set of ids (a search result, a board
 * delta) in one call, under the caller's data scope (web-deals-scale
 * design, step 1).
 */
import { DealStatus } from '@bitcrm/types';
import { DealsService } from '../../../src/deals/deals.service';
import { DealsRepository } from '../../../src/deals/deals.repository';
import { createMockDeal, createMockDealsRepository, createMockDynamoDbService, createMockJwtUser } from '../mocks';

function serviceWith(repo: ReturnType<typeof createMockDealsRepository>): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

describe('DealsRepository.findByIds', () => {
  it('batch-gets the metadata rows and keeps the order asked, minus the missing', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({
      Responses: {
        [(repository as any).tableName]: [
          { ...createMockDeal({ id: 'b' }), PK: 'DEAL#b', SK: 'METADATA' },
          { ...createMockDeal({ id: 'a' }), PK: 'DEAL#a', SK: 'METADATA' },
        ],
      },
    });
    const found = await repository.findByIds(['a', 'missing', 'b']);
    expect(found.map((d) => d.id)).toEqual(['a', 'b']);
  });
});

describe('DealsService.findByIds', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;

  beforeEach(() => {
    repo = createMockDealsRepository();
    (repo as any).findByIds = jest.fn().mockResolvedValue([
      createMockDeal({ id: 'a', assignedTechIds: ['tech-1'] }),
      createMockDeal({ id: 'b', assignedTechIds: ['tech-2'] }),
      createMockDeal({ id: 'c', assignedTechIds: ['tech-1'], status: DealStatus.DELETED }),
    ]);
  });

  it('answers every active deal for a caller with full scope', async () => {
    const service = serviceWith(repo);
    const out = await service.findByIds(['a', 'b', 'c'], createMockJwtUser({ id: 'disp-1' }));
    expect(out.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('under assigned_only only the caller’s own deals come back', async () => {
    const service = serviceWith(repo);
    const out = await service.findByIds(['a', 'b', 'c'], createMockJwtUser({ id: 'tech-1' }), 'assigned_only');
    expect(out.map((d) => d.id)).toEqual(['a']);
  });

  it('de-duplicates the ids before asking', async () => {
    const service = serviceWith(repo);
    await service.findByIds(['a', 'a', 'b'], createMockJwtUser({ id: 'disp-1' }));
    expect((repo as any).findByIds).toHaveBeenCalledWith(['a', 'b']);
  });
});

describe('DealsRepository.findByIds — the batch read itself', () => {
  const table = 'BitCRM_Deals';

  it('reads only what a Deal is built from (projection), not the ~4 KB row with its search halves', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({ Responses: { [table]: [] } });
    await new DealsRepository(dynamoDb as any).findByIds(['a']);
    const req = dynamoDb.client.send.mock.calls[0][0].input.RequestItems[table];
    const attrs = req.ProjectionExpression.split(', ').map((p: string) => req.ExpressionAttributeNames[p]);
    expect(attrs).toEqual(expect.arrayContaining(['id', 'status', 'superStatus', 'stage', 'assignedTechIds', 'totals', 'clientPhone']));
    expect(attrs).not.toContain('searchText');
    expect(attrs).not.toContain('clientSearchText');
  });

  it('asks again for what DynamoDB left unprocessed', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send
      .mockResolvedValueOnce({
        Responses: { [table]: [{ ...createMockDeal({ id: 'a' }) }] },
        UnprocessedKeys: { [table]: { Keys: [{ PK: 'DEAL#b', SK: 'METADATA' }], ProjectionExpression: 'x' } },
      })
      .mockResolvedValueOnce({ Responses: { [table]: [{ ...createMockDeal({ id: 'b' }) }] } });
    const found = await new DealsRepository(dynamoDb as any).findByIds(['a', 'b']);
    expect(found.map((d) => d.id)).toEqual(['a', 'b']);
    expect(dynamoDb.client.send.mock.calls[1][0].input.RequestItems[table].Keys).toEqual([{ PK: 'DEAL#b', SK: 'METADATA' }]);
  });

  it('chunks of 100, read side by side', async () => {
    const dynamoDb = createMockDynamoDbService();
    let inFlight = 0;
    let peak = 0;
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      const keys = cmd.input.RequestItems[table].Keys as Array<{ PK: string }>;
      return { Responses: { [table]: keys.map((k) => createMockDeal({ id: k.PK.slice(5) })) } };
    });
    const ids = Array.from({ length: 250 }, (_, i) => `d${i}`);
    const found = await new DealsRepository(dynamoDb as any).findByIds(ids);
    expect(found.map((d) => d.id)).toEqual(ids);
    expect(dynamoDb.client.send.mock.calls.map((c: any[]) => c[0].input.RequestItems[table].Keys.length)).toEqual([100, 100, 50]);
    expect(peak).toBe(3);
  });

  it('with filters it still reads the whole row (the search halves are matched on it)', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({ Responses: { [table]: [] } });
    await new DealsRepository(dynamoDb as any).findByIds(['a'], { text: { text: 'x' } } as any);
    expect(dynamoDb.client.send.mock.calls[0][0].input.RequestItems[table].ProjectionExpression).toBeUndefined();
  });
});

describe('DealsService.findByIdsInternal — K1, `POST /deals/internal/by-ids`', () => {
  it('every found deal, deleted ones included (as `GET internal/:id`), ids de-duplicated, missing ones absent', async () => {
    const repo = createMockDealsRepository();
    (repo as any).findByIds = jest.fn().mockResolvedValue([
      createMockDeal({ id: 'a' }),
      createMockDeal({ id: 'c', status: DealStatus.DELETED }),
    ]);
    const out = await serviceWith(repo).findByIdsInternal(['a', 'a', 'missing', 'c']);
    expect((repo as any).findByIds).toHaveBeenCalledWith(['a', 'missing', 'c']);
    expect(out.map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('no ids, no read', async () => {
    const repo = createMockDealsRepository();
    (repo as any).findByIds = jest.fn();
    await expect(serviceWith(repo).findByIdsInternal([])).resolves.toEqual([]);
    expect((repo as any).findByIds).not.toHaveBeenCalled();
  });
});
