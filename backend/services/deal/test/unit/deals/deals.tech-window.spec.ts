/**
 * A technician's jobs in a window of days read the tech index directly —
 * its sort key already is the visit date — instead of scanning the schedule
 * index of every status with a contains() filter (web-deals-scale design,
 * step 5).
 */
import { JobSuperStatus } from '@bitcrm/types';
import { DealsService } from '../../../src/deals/deals.service';
import { DealsRepository } from '../../../src/deals/deals.repository';
import { createMockDealsRepository, createMockDynamoDbService, createMockJwtUser } from '../mocks';

function serviceWith(repo: ReturnType<typeof createMockDealsRepository>): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

describe('DealsRepository.findByTech with a window', () => {
  it('bounds the tech index by the visit days', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.findByTech('tech-1', 20, undefined, undefined, { from: '2026-09-21', to: '2026-09-27' });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('TechIndex');
    expect(input.KeyConditionExpression).toBe('GSI2PK = :pk AND GSI2SK BETWEEN :from AND :to');
    expect(input.ExpressionAttributeValues[':pk']).toBe('TECH#tech-1');
    expect(input.ExpressionAttributeValues[':from']).toBe('2026-09-21');
    // '~' sits above any suffix of the last day (a date, or an ISO stamp of an undated assignment).
    expect(input.ExpressionAttributeValues[':to']).toBe('2026-09-27~');
  });

  it('without a window the key condition is the technician alone, as before', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await repository.findByTech('tech-1', 20);
    expect(dynamoDb.client.send.mock.calls[0][0].input.KeyConditionExpression).toBe('GSI2PK = :pk');
  });

  it('reads ascending for an ascending sort', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await repository.findByTech('tech-1', 20, undefined, undefined, { from: '2026-09-21', to: '2026-09-21' }, 'asc');
    expect(dynamoDb.client.send.mock.calls[0][0].input.ScanIndexForward).toBe(true);
  });
});

describe('DealsService.list — a technician with a window', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  const page = { items: [], nextCursor: undefined };
  const caller = createMockJwtUser({ id: 'disp-1' });

  beforeEach(() => {
    repo = createMockDealsRepository();
    (repo as any).findBySchedule = jest.fn().mockResolvedValue(page);
    repo.findByTech.mockResolvedValue(page);
  });

  it('techId with a date window and no status reads the tech index', async () => {
    await serviceWith(repo).list({ techId: 'tech-1', scheduledFrom: '2026-09-21', scheduledTo: '2026-09-27' } as any, caller);
    expect(repo.findByTech).toHaveBeenCalledWith(
      'tech-1',
      20,
      undefined,
      expect.objectContaining({ techId: 'tech-1' }),
      { from: '2026-09-21', to: '2026-09-27', unscheduled: false },
      'asc',
    );
    expect((repo as any).findBySchedule).not.toHaveBeenCalled();
  });

  it('under assigned_only the caller’s own window reads the tech index too', async () => {
    await serviceWith(repo).list({ scheduledFrom: '2026-09-23' } as any, createMockJwtUser({ id: 'tech-9' }), 'assigned_only');
    expect(repo.findByTech).toHaveBeenCalledWith('tech-9', 20, undefined, expect.any(Object), expect.objectContaining({ from: '2026-09-23' }), 'asc');
  });

  it('a status tab keeps the schedule index — the status partition is the smaller read', async () => {
    await serviceWith(repo).list({ techId: 'tech-1', superStatus: JobSuperStatus.SUBMITTED, scheduledFrom: '2026-09-23' } as any, caller);
    expect((repo as any).findBySchedule).toHaveBeenCalled();
    expect(repo.findByTech).not.toHaveBeenCalled();
  });

  it('the undated tab is a schedule-index question, even for a technician', async () => {
    await serviceWith(repo).list({ techId: 'tech-1', unscheduled: 'true' } as any, caller);
    expect((repo as any).findBySchedule).toHaveBeenCalled();
  });
});
