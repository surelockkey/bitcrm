/**
 * The list under a data scope: whichever index answers, the technician
 * filter must reach it. Before this, `?superStatus=…` took the status index
 * and forgot the caller's `techId`, so an `assigned_only` technician saw
 * every job in that status (web-deals-scale design, step 0).
 */
import { JobSuperStatus } from '@bitcrm/types';
import { DealsService } from '../../../src/deals/deals.service';
import { DealsRepository, type DealFilters } from '../../../src/deals/deals.repository';
import { createMockDealsRepository, createMockDynamoDbService, createMockJwtUser } from '../mocks';

const caller = createMockJwtUser({ id: 'tech-1', roleId: 'role-technician' });

/**
 * `list()` touches only the repository, so the other fourteen collaborators
 * are stand-ins — the same shortcut the constructor's `@Optional()` deps
 * exist for.
 */
function serviceWith(repo: ReturnType<typeof createMockDealsRepository>): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

describe('DealsService.list — technician filter on every index', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  let service: DealsService;
  const page = { items: [], nextCursor: undefined };

  beforeEach(() => {
    repo = createMockDealsRepository();
    for (const fn of ['findBySuperStatus', 'findByTech', 'findByContact', 'findByDispatcher', 'findAll']) {
      (repo as any)[fn].mockResolvedValue(page);
    }
    service = serviceWith(repo);
  });

  it('assigned_only + superStatus keeps the status index but filters by the caller', async () => {
    await service.list({ superStatus: JobSuperStatus.SUBMITTED } as any, caller, 'assigned_only');
    expect(repo.findBySuperStatus).toHaveBeenCalledWith(
      JobSuperStatus.SUBMITTED,
      20,
      undefined,
      expect.objectContaining<Partial<DealFilters>>({ techId: 'tech-1' }),
    );
    expect(repo.findByTech).not.toHaveBeenCalled();
  });

  it('an explicit techId with superStatus reaches the filter too', async () => {
    await service.list({ superStatus: JobSuperStatus.DONE, techId: 'tech-9' } as any, caller);
    expect(repo.findBySuperStatus).toHaveBeenCalledWith(
      JobSuperStatus.DONE,
      20,
      undefined,
      expect.objectContaining({ techId: 'tech-9' }),
    );
  });

  it('assigned_only + contactId filters the contact index by the caller', async () => {
    await service.list({ contactId: 'c-1' } as any, caller, 'assigned_only');
    expect(repo.findByContact).toHaveBeenCalledWith(
      'c-1',
      20,
      undefined,
      expect.objectContaining({ techId: 'tech-1' }),
    );
  });

  it('assigned_only + dispatcherId filters the dispatcher index by the caller', async () => {
    await service.list({ dispatcherId: 'd-1' } as any, caller, 'assigned_only');
    expect(repo.findByDispatcher).toHaveBeenCalledWith(
      'd-1',
      20,
      undefined,
      expect.objectContaining({ techId: 'tech-1' }),
    );
  });

  it('without a scope and without techId nothing is filtered by technician', async () => {
    await service.list({ superStatus: JobSuperStatus.SUBMITTED } as any, caller);
    const filters = repo.findBySuperStatus.mock.calls[0][3] as DealFilters;
    expect(filters.techId).toBeUndefined();
  });
});

describe('DealsRepository — the technician filter is a contains() on assignedTechIds', () => {
  it('findBySuperStatus adds contains(#assignedTechIds, :techId) to the FilterExpression', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    const repository = new DealsRepository(dynamoDb as any);

    await repository.findBySuperStatus(JobSuperStatus.SUBMITTED, 20, undefined, { techId: 'tech-1' });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('contains(#assignedTechIds, :techId)');
    expect(input.ExpressionAttributeNames['#assignedTechIds']).toBe('assignedTechIds');
    expect(input.ExpressionAttributeValues[':techId']).toBe('tech-1');
  });

  it('findByTech ignores a techId filter — the index key already is the technician', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    const repository = new DealsRepository(dynamoDb as any);

    await repository.findByTech('tech-1', 20, undefined, { techId: 'tech-1' });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues[':pk']).toBe('TECH#tech-1');
  });
});
