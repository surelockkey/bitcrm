/**
 * The Jobs report reads a window on the date it is "By:" — created,
 * scheduled or closed — off an index keyed by that date, never the table
 * (web-deals-scale design, step 10). Created is the status index's own sort
 * key; closed is the sparse ClosedIndex, one partition a month.
 */
import { JobSuperStatus } from '@bitcrm/types';
import { BadRequestException } from '@nestjs/common';
import { DealsService } from '../../../src/deals/deals.service';
import { DealsRepository, closedIndexKeys } from '../../../src/deals/deals.repository';
import { createMockDeal, createMockDealsRepository, createMockDynamoDbService, createMockJwtUser } from '../mocks';

function serviceWith(repo: ReturnType<typeof createMockDealsRepository>): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

describe('closedIndexKeys', () => {
  it('a closed deal keys on its closing month and moment', () => {
    expect(closedIndexKeys({ id: 'd1', closedAt: '2026-09-23T14:05:00.000Z' })).toEqual({
      GSI6PK: 'CLOSED#2026-09',
      GSI6SK: '2026-09-23T14:05:00.000Z#DEAL#d1',
    });
  });
  it('an open deal has no keys — the index is sparse', () => {
    expect(closedIndexKeys({ id: 'd1' })).toBeUndefined();
  });
});

describe('DealsRepository — the closed index follows closedAt', () => {
  it('update() that closes a deal stamps GSI6 from the row after the write', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    const after = { ...createMockDeal({ id: 'd1', superStatus: JobSuperStatus.DONE }), closedAt: '2026-09-23T14:05:00.000Z', PK: 'DEAL#d1', SK: 'METADATA' };
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: after });
    const deal = await repository.update('d1', { superStatus: JobSuperStatus.DONE, closedAt: '2026-09-23T14:05:00.000Z' });
    const restamp = dynamoDb.client.send.mock.calls[1][0].input;
    expect(restamp.ExpressionAttributeValues[':gsi6pk']).toBe('CLOSED#2026-09');
    expect(restamp.ExpressionAttributeValues[':gsi6sk']).toBe('2026-09-23T14:05:00.000Z#DEAL#d1');
    expect(deal.closedAt).toBe('2026-09-23T14:05:00.000Z');
  });

  it('update() that reopens a deal removes the GSI6 keys', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    const after = { ...createMockDeal({ id: 'd1', superStatus: JobSuperStatus.PENDING }), PK: 'DEAL#d1', SK: 'METADATA' };
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: after });
    await repository.update('d1', { superStatus: JobSuperStatus.PENDING, closedAt: null });
    const restamp = dynamoDb.client.send.mock.calls[1][0].input;
    expect(restamp.UpdateExpression).toMatch(/REMOVE .*GSI6PK, GSI6SK/);
  });

  it('toDeal reads closedAt', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Item: { ...createMockDeal({ id: 'd1' }), closedAt: '2026-09-23T14:05:00.000Z', PK: 'DEAL#d1', SK: 'METADATA' } });
    const deal = await repository.findById('d1');
    expect(deal?.closedAt).toBe('2026-09-23T14:05:00.000Z');
  });
});

describe('DealsRepository.findByCreated', () => {
  it('bounds the status index by the creation days', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await repository.findByCreated([JobSuperStatus.DONE], { from: '2026-09-01', to: '2026-09-30' }, 50, undefined, undefined, 'desc');
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('StageIndex');
    expect(input.KeyConditionExpression).toBe('#pk = :pk AND #sk BETWEEN :from AND :to');
    expect(input.ExpressionAttributeNames['#pk']).toBe('GSI1PK');
    expect(input.ExpressionAttributeNames['#sk']).toBe('GSI1SK');
    expect(input.ExpressionAttributeValues[':from']).toBe('2026-09-01');
    expect(input.ExpressionAttributeValues[':to']).toBe('2026-09-30~');
    expect(input.ScanIndexForward).toBe(false);
  });

  it('several statuses are merged on the creation key', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    const row = (id: string, status: JobSuperStatus, at: string) => ({
      ...createMockDeal({ id, superStatus: status, createdAt: at }), PK: `DEAL#${id}`, SK: 'METADATA', GSI1PK: `STATUS#${status}`, GSI1SK: `${at}#DEAL#${id}`,
    });
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const pk = cmd.input.ExpressionAttributeValues[':pk'];
      if (pk === 'STATUS#done') return { Items: [row('a', JobSuperStatus.DONE, '2026-09-05T10:00:00.000Z')] };
      if (pk === 'STATUS#canceled') return { Items: [row('b', JobSuperStatus.CANCELED, '2026-09-03T10:00:00.000Z')] };
      return { Items: [] };
    });
    // Newest first by default: the 5th before the 3rd.
    const page = await repository.findByCreated([JobSuperStatus.DONE, JobSuperStatus.CANCELED], { from: '2026-09-01', to: '2026-09-30' }, 10);
    expect(page.items.map((d) => d.id)).toEqual(['a', 'b']);
  });
});

describe('DealsRepository.findByClosed', () => {
  it('reads one month partition per month in the window, merged on the closing moment', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    const seen: string[] = [];
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      seen.push(cmd.input.ExpressionAttributeValues[':pk']);
      expect(cmd.input.IndexName).toBe('ClosedIndex');
      expect(cmd.input.KeyConditionExpression).toBe('#pk = :pk AND #sk BETWEEN :from AND :to');
      expect(cmd.input.ExpressionAttributeNames['#pk']).toBe('GSI6PK');
      return { Items: [] };
    });
    await repository.findByClosed({ from: '2026-08-20', to: '2026-10-02' }, 50);
    expect(seen).toEqual(['CLOSED#2026-08', 'CLOSED#2026-09', 'CLOSED#2026-10']);
  });

  it('a status narrows the closed rows with a filter, not a key', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await repository.findByClosed({ from: '2026-09-01', to: '2026-09-30' }, 50, undefined, { superStatus: JobSuperStatus.CANCELED });
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('#superStatus = :superStatus');
    expect(input.ExpressionAttributeValues[':superStatus']).toBe('canceled');
  });
});

describe('DealsService.list — the report windows', () => {
  let repo: ReturnType<typeof createMockDealsRepository>;
  const page = { items: [], nextCursor: undefined };
  const caller = createMockJwtUser({ id: 'disp-1' });

  beforeEach(() => {
    repo = createMockDealsRepository();
    (repo as any).findByCreated = jest.fn().mockResolvedValue(page);
    (repo as any).findByClosed = jest.fn().mockResolvedValue(page);
    (repo as any).findBySchedule = jest.fn().mockResolvedValue(page);
  });

  it('createdFrom/To reads the creation window of every status, newest first by default', async () => {
    await serviceWith(repo).list({ createdFrom: '2026-09-01', createdTo: '2026-09-30' } as any, caller);
    expect((repo as any).findByCreated).toHaveBeenCalledWith(
      expect.arrayContaining([JobSuperStatus.SUBMITTED, JobSuperStatus.CANCELED]),
      { from: '2026-09-01', to: '2026-09-30' },
      20,
      undefined,
      expect.any(Object),
      'desc',
    );
  });

  it('closedFrom/To reads the closed index, with the status as a filter', async () => {
    await serviceWith(repo).list({ closedFrom: '2026-09-01', closedTo: '2026-09-30', superStatus: JobSuperStatus.DONE } as any, caller);
    expect((repo as any).findByClosed).toHaveBeenCalledWith(
      { from: '2026-09-01', to: '2026-09-30' },
      20,
      undefined,
      expect.objectContaining({ superStatus: JobSuperStatus.DONE }),
      'desc',
    );
  });

  it('a report window may span a quarter, not more', async () => {
    await serviceWith(repo).list({ createdFrom: '2026-07-01', createdTo: '2026-09-30' } as any, caller);
    await expect(serviceWith(repo).list({ createdFrom: '2026-01-01', createdTo: '2026-09-30' } as any, caller)).rejects.toBeInstanceOf(BadRequestException);
    await expect(serviceWith(repo).list({ closedFrom: '2026-01-01', closedTo: '2026-09-30' } as any, caller)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('two date windows at once is a contradiction', async () => {
    await expect(
      serviceWith(repo).list({ createdFrom: '2026-09-01', scheduledFrom: '2026-09-01' } as any, caller),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DealsService.counts — on the report windows', () => {
  it('createdFrom/To counts each status on the creation window and answers a total', async () => {
    const repo = createMockDealsRepository();
    (repo as any).countByCreated = jest.fn().mockResolvedValue(2);
    (repo as any).countBySchedule = jest.fn().mockResolvedValue(9);
    const cache = { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn() };
    const stub = {} as any;
    const service = new DealsService(repo as any, cache as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub);
    const counts = await service.counts({ createdFrom: '2026-09-01', createdTo: '2026-09-30' } as any, createMockJwtUser({ id: 'd' }));
    expect(counts.done).toBe(2);
    expect(counts.canceled).toBe(2);
    expect(counts.total).toBe(12);
    expect((repo as any).countBySchedule).not.toHaveBeenCalled();
  });

  it('closedFrom/To counts the closed index per status', async () => {
    const repo = createMockDealsRepository();
    (repo as any).countByClosed = jest.fn(async (_w: unknown, f: any) => (f.superStatus === JobSuperStatus.DONE ? 5 : 0));
    const cache = { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn() };
    const stub = {} as any;
    const service = new DealsService(repo as any, cache as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub);
    const counts = await service.counts({ closedFrom: '2026-09-01', closedTo: '2026-09-30' } as any, createMockJwtUser({ id: 'd' }));
    expect(counts.done).toBe(5);
    expect(counts.canceled).toBe(0);
    expect(counts.submitted).toBe(0);
    expect(counts.total).toBe(5);
    expect(counts.unscheduled).toBe(0);
  });
});
