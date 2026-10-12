/**
 * `DealsRepository.readMapJobs` — the dispatch map's one read.
 *
 * The board used to drain the jobs list a hundred rows a page, one page after
 * another, four statuses at a time: `pending` alone took three round trips
 * through the gateway. Here every status partition of the schedule index
 * (`STATUS#<s>`, sorted by visit day) is walked to its end at once, projected
 * to what the board draws, and Done / Canceled are read one visit day per
 * query over the date box's days — never their hundreds of thousands of rows.
 */
import { JobSuperStatus } from '@bitcrm/types';
import { DealsRepository, DISPATCH_MAP_FIELDS } from 'src/deals/deals.repository';
import { createMockDynamoDbService } from '../mocks';

type Send = ReturnType<typeof createMockDynamoDbService>['client']['send'];

/** A METADATA row as the index holds it — far more than the board draws. */
function row(id: string, over: Record<string, unknown> = {}) {
  return {
    PK: `DEAL#${id}`,
    SK: 'METADATA',
    id,
    dealNumber: 4711,
    contactId: `c-${id}`,
    superStatus: 'submitted',
    status: 'active',
    assignedTechIds: [],
    tagIds: [],
    ...over,
  };
}

/** What the read asked DynamoDB, call by call. */
const inputs = (send: Send) => send.mock.calls.map((c: any[]) => c[0].input);

/** The attribute names a ProjectionExpression of `#pN` aliases resolves to. */
function projected(input: any): string[] {
  return String(input.ProjectionExpression)
    .split(',')
    .map((alias) => input.ExpressionAttributeNames[alias.trim()]);
}

describe('DealsRepository.readMapJobs', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
  });

  it('walks an open status’s partition of the schedule index to its end — no hundred-row cap', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [row('a'), row('b')], LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Items: [row('c')], LastEvaluatedKey: { k: 2 } })
      .mockResolvedValueOnce({ Items: [row('d')] });

    const deals = await repository.readMapJobs([{ status: JobSuperStatus.PENDING }]);

    expect(deals.map((d) => d.id)).toEqual(['a', 'b', 'c', 'd']);
    const asked = inputs(dynamoDb.client.send);
    expect(asked).toHaveLength(3);
    expect(asked[0]).toMatchObject({
      IndexName: 'StatusScheduleIndex',
      KeyConditionExpression: '#pk = :pk',
      ScanIndexForward: true,
    });
    expect(asked[0].ExpressionAttributeNames['#pk']).toBe('GSI5PK');
    expect(asked[0].ExpressionAttributeValues[':pk']).toBe('STATUS#pending');
    expect(asked[0].Limit).toBeUndefined();
    expect(asked[0].ExclusiveStartKey).toBeUndefined();
    expect(asked[1].ExclusiveStartKey).toEqual({ k: 1 });
    expect(asked[2].ExclusiveStartKey).toEqual({ k: 2 });
  });

  it('projects the rows to what the board draws, and nothing heavier', async () => {
    await repository.readMapJobs([{ status: JobSuperStatus.SUBMITTED }]);

    const names = projected(inputs(dynamoDb.client.send)[0]);
    expect(names.sort()).toEqual([...DISPATCH_MAP_FIELDS].sort());
    // What the pins, the cards and the search read…
    for (const f of ['id', 'dealNumber', 'contactId', 'superStatus', 'address', 'jobTypeId', 'serviceArea',
      'scheduledDate', 'scheduledEndDate', 'scheduledTimeSlot', 'allDay', 'assignedTechIds', 'sequences',
      'clientName', 'phones']) {
      expect(DISPATCH_MAP_FIELDS).toContain(f);
    }
    // …and every field a `Deal` must have, so a row is an honest `Deal`.
    for (const f of ['clientType', 'assignedDispatcherId', 'priority', 'tagIds', 'status', 'createdBy', 'createdAt',
      'updatedAt']) {
      expect(DISPATCH_MAP_FIELDS).toContain(f);
    }
    // Never the bulky ones: notes, money, custom answers, the search halves.
    for (const f of ['notes', 'internalNotes', 'customFields', 'totals', 'discount', 'searchText',
      'clientSearchText', 'workizDiscount']) {
      expect(DISPATCH_MAP_FIELDS).not.toContain(f);
    }
  });

  it('keeps deleted jobs off the map', async () => {
    await repository.readMapJobs([{ status: JobSuperStatus.SUBMITTED }]);

    const input = inputs(dynamoDb.client.send)[0];
    expect(input.FilterExpression).toBe('#status = :active');
    expect(input.ExpressionAttributeNames['#status']).toBe('status');
    expect(input.ExpressionAttributeValues[':active']).toBe('active');
  });

  it('narrows every partition to one technician’s jobs (an `assigned_only` caller)', async () => {
    await repository.readMapJobs(
      [{ status: JobSuperStatus.SUBMITTED }, { status: JobSuperStatus.PENDING }],
      { techId: 'tech-7' },
    );

    for (const input of inputs(dynamoDb.client.send)) {
      expect(input.FilterExpression).toBe('#status = :active AND contains(#assignedTechIds, :techId)');
      expect(input.ExpressionAttributeNames['#assignedTechIds']).toBe('assignedTechIds');
      expect(input.ExpressionAttributeValues[':techId']).toBe('tech-7');
    }
  });

  it('reads Done / Canceled one visit day per query over the window, all at once, in day order', async () => {
    // The middle day answers last: the rows still come back in day order.
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const from = cmd.input.ExpressionAttributeValues[':from'] as string;
      const day = from.slice(0, 10);
      if (day === '2026-10-12') await new Promise((r) => setTimeout(r, 20));
      return { Items: [row(`done-${day}`, { superStatus: 'done', scheduledDate: day })] };
    });

    const deals = await repository.readMapJobs([
      { status: JobSuperStatus.DONE, window: { from: '2026-10-11', to: '2026-10-13' } },
    ]);

    expect(deals.map((d) => d.id)).toEqual(['done-2026-10-11', 'done-2026-10-12', 'done-2026-10-13']);
    const asked = inputs(dynamoDb.client.send);
    expect(asked).toHaveLength(3);
    expect(asked[0].KeyConditionExpression).toBe('#pk = :pk AND #sk BETWEEN :from AND :to');
    expect(asked[0].ExpressionAttributeNames['#sk']).toBe('GSI5SK');
    expect(asked.map((i: any) => [i.ExpressionAttributeValues[':pk'], i.ExpressionAttributeValues[':from'], i.ExpressionAttributeValues[':to']])).toEqual([
      ['STATUS#done', '2026-10-11#', '2026-10-11#~~'],
      ['STATUS#done', '2026-10-12#', '2026-10-12#~~'],
      ['STATUS#done', '2026-10-13#', '2026-10-13#~~'],
    ]);
  });

  it('asks every status at once, and answers in the order asked, each in visit order', async () => {
    let inFlight = 0;
    let most = 0;
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      const status = String(cmd.input.ExpressionAttributeValues[':pk']).replace('STATUS#', '');
      return { Items: [row(`${status}-1`, { superStatus: status }), row(`${status}-2`, { superStatus: status })] };
    });

    const deals = await repository.readMapJobs([
      { status: JobSuperStatus.SUBMITTED },
      { status: JobSuperStatus.IN_PROGRESS },
      { status: JobSuperStatus.PENDING },
      { status: JobSuperStatus.DONE_PENDING_APPROVAL },
    ]);

    expect(most).toBe(4);
    expect(deals.map((d) => d.id)).toEqual([
      'submitted-1', 'submitted-2', 'in_progress-1', 'in_progress-2',
      'pending-1', 'pending-2', 'done_pending_approval-1', 'done_pending_approval-2',
    ]);
  });

  it('answers `Deal`s: the number as a string, the lists filled, nothing it did not read', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Items: [row('a', { assignedTechIds: undefined, tagIds: undefined })] });

    const [deal] = await repository.readMapJobs([{ status: JobSuperStatus.SUBMITTED }]);

    expect(deal.dealNumber).toBe('4711');
    expect(deal.assignedTechIds).toEqual([]);
    expect(deal.tagIds).toEqual([]);
    expect(deal).not.toHaveProperty('PK');
    expect(JSON.parse(JSON.stringify(deal))).not.toHaveProperty('notes');
  });

  it('keeps a job once if a move between statuses lands it in two reads', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [row('a')] })
      .mockResolvedValueOnce({ Items: [row('a', { superStatus: 'pending' }), row('b')] });

    const deals = await repository.readMapJobs([{ status: JobSuperStatus.SUBMITTED }, { status: JobSuperStatus.PENDING }]);

    expect(deals.map((d) => d.id)).toEqual(['a', 'b']);
  });
});
