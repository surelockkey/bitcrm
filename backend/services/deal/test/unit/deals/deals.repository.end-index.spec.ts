/**
 * GSI7 EndIndex — the Jobs report's "By: Job end date" (Workiz `report_by=3`).
 *
 *   GSI7PK = END#<YYYY-MM>
 *   GSI7SK = <jobEndAt>#DEAL#<id>     jobEndAt = the visit's end on the Eastern clock
 *
 * Plus the report's window reads over the three dates.
 */
import { JobSuperStatus } from '@bitcrm/types';
import {
  DealsRepository,
  endIndexKeys,
  ReportWindowTooLargeError,
} from '../../../src/deals/deals.repository';
import { REPORT_PROJECTION } from '../../../src/deals/report/jobs-report.logic';
import { createMockDeal, createMockDynamoDbService } from '../mocks';

describe('endIndexKeys', () => {
  it('keys a native visit on its end date and slot end', () => {
    expect(endIndexKeys({ id: 'd1', scheduledDate: '2026-09-23', scheduledEndDate: '2026-09-25', scheduledTimeSlot: '09:30-11:00' })).toEqual({
      GSI7PK: 'END#2026-09',
      GSI7SK: '2026-09-25T11:00#DEAL#d1',
    });
  });

  it('keys an imported visit on the Eastern clock of the instant Workiz held', () => {
    expect(
      endIndexKeys({
        id: 'd1',
        scheduledDate: '2026-09-30',
        scheduledEndDate: '2026-09-30',
        scheduledTimeSlot: '22:00-23:30',
        jobTimezone: 'America/Chicago',
        jobEndDateUtc: '2026-10-01T04:30:00.000Z',
      }),
    ).toEqual({ GSI7PK: 'END#2026-10', GSI7SK: '2026-10-01T00:30#DEAL#d1' });
  });

  it('keys an undated job an hour after its creation, and a row with no dates not at all', () => {
    expect(endIndexKeys({ id: 'd1', createdAt: '2026-09-01T12:00:00.000Z' })?.GSI7SK).toBe('2026-09-01T09:00#DEAL#d1');
    expect(endIndexKeys({ id: 'd1' })).toBeUndefined();
  });
});

describe('DealsRepository — writing the end index', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  it('create() writes GSI7 beside the other index keys', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockDeal({ id: 'd1', scheduledDate: '2026-09-23', scheduledTimeSlot: '14:00-16:00' }));
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.GSI7PK).toBe('END#2026-09');
    expect(item.GSI7SK).toBe('2026-09-23T16:00#DEAL#d1');
  });

  it('update() of the end date restamps GSI7 from the whole row, imported instants included', async () => {
    const after = {
      ...createMockDeal({ id: 'd1', superStatus: JobSuperStatus.DONE }),
      PK: 'DEAL#d1',
      SK: 'METADATA',
      scheduledDate: '2026-09-24',
      scheduledEndDate: '2026-09-24',
      scheduledTimeSlot: '08:00-12:00',
      jobTimezone: 'America/Chicago',
      jobEndDateUtc: '2026-09-24T17:00:00.000Z',
    };
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: after });
    await repository.update('d1', { scheduledEndDate: '2026-09-24' });
    const restamp = dynamoDb.client.send.mock.calls[1][0].input;
    expect(restamp.UpdateExpression).toContain('GSI7PK = :gsi7pk');
    expect(restamp.ExpressionAttributeValues[':gsi7pk']).toBe('END#2026-09');
    expect(restamp.ExpressionAttributeValues[':gsi7sk']).toBe('2026-09-24T13:00#DEAL#d1');
  });

  it('an update that touches no date leaves the index keys alone', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: { ...createMockDeal(), PK: 'DEAL#deal-1', SK: 'METADATA' } });
    await repository.update('deal-1', { notes: 'x' });
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
  });
});

describe('DealsRepository.readReportWindow', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;
  const inputs = () => dynamoDb.client.send.mock.calls.map((c: any[]) => c[0].input);

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  it('by created: the status index, six statuses, Eastern days as UTC instants', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [{ id: 'a' }] });
    const rows = await repository.readReportWindow('created', '2026-09-01', '2026-09-27', REPORT_PROJECTION);
    expect(rows).toHaveLength(6);
    const q = inputs();
    expect(q).toHaveLength(6);
    expect(q[0].IndexName).toBe('StageIndex');
    expect(q.map((i: any) => i.ExpressionAttributeValues[':pk']).sort()).toEqual(
      ['STATUS#canceled', 'STATUS#done', 'STATUS#done_pending_approval', 'STATUS#in_progress', 'STATUS#pending', 'STATUS#submitted'],
    );
    expect(q[0].ExpressionAttributeValues[':from']).toBe('2026-09-01T04:00:00.000Z');
    expect(q[0].ExpressionAttributeValues[':to']).toBe('2026-09-28T04:00:00.000Z');
    // Only active rows, and only the projected attributes.
    expect(q[0].FilterExpression).toBe('#status = :active');
    expect(q[0].ExpressionAttributeValues[':active']).toBe('active');
    expect(q[0].ProjectionExpression.split(', ')).toHaveLength(REPORT_PROJECTION.length);
  });

  it('by scheduled: a day either side of the local visit days, plus undated jobs by creation', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await repository.readReportWindow('scheduled', '2026-09-01', '2026-09-27', REPORT_PROJECTION);
    const q = inputs();
    expect(q).toHaveLength(12);
    const dated = q.find((i: any) => i.ExpressionAttributeValues[':from']);
    expect(dated.IndexName).toBe('StatusScheduleIndex');
    expect(dated.ExpressionAttributeValues[':from']).toBe('2026-08-31#');
    expect(dated.ExpressionAttributeValues[':to']).toBe('2026-09-28#~~');
    const undated = q.find((i: any) => i.ExpressionAttributeValues[':unsched']);
    expect(undated.KeyConditionExpression).toBe('#pk = :pk AND begins_with(#sk, :unsched)');
    expect(undated.FilterExpression).toBe('#status = :active AND #createdAt BETWEEN :createdFrom AND :createdTo');
  });

  it('by end: one query per month on the EndIndex, walked to the end of each', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ id: 'a' }], LastEvaluatedKey: { PK: 'x' } })
      .mockResolvedValue({ Items: [{ id: 'b' }] });
    const rows = await repository.readReportWindow('end', '2026-08-20', '2026-09-27', REPORT_PROJECTION);
    const q = inputs();
    expect(q.map((i: any) => i.IndexName)).toEqual(['EndIndex', 'EndIndex', 'EndIndex']);
    expect(q.map((i: any) => i.ExpressionAttributeValues[':pk']).sort()).toEqual(['END#2026-08', 'END#2026-08', 'END#2026-09']);
    expect(q[0].ExpressionAttributeValues[':from']).toBe('2026-08-20');
    expect(q[0].ExpressionAttributeValues[':to']).toBe('2026-09-27~');
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b', 'b']);
  });

  it('stops a window that would hold more jobs than the guard allows', async () => {
    const page = { Items: Array.from({ length: 30_000 }, (_, i) => ({ id: String(i) })) };
    dynamoDb.client.send.mockResolvedValue(page);
    await expect(repository.readReportWindow('created', '2026-01-01', '2026-12-31', REPORT_PROJECTION)).rejects.toBeInstanceOf(
      ReportWindowTooLargeError,
    );
  });
});
