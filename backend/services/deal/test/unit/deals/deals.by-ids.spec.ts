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
