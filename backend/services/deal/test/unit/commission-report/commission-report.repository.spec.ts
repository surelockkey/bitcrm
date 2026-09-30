import {
  CommissionReportRepository,
  daySegments,
  shiftDay,
} from 'src/commission-report/commission-report.repository';
import { DEALS_TABLE } from 'src/common/constants/dynamo.constants';
import { createMockDynamoDbService } from '../mocks';

type Sent = { constructor: { name: string }; input: Record<string, any> };

describe('day arithmetic', () => {
  it('shifts across month and year ends', () => {
    expect(shiftDay('2026-09-01', -31)).toBe('2026-08-01');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('slices a span into consecutive pieces that cover it exactly', () => {
    expect(daySegments('2026-08-01', '2026-09-27')).toEqual([
      { from: '2026-08-01', to: '2026-08-16' },
      { from: '2026-08-17', to: '2026-09-01' },
      { from: '2026-09-02', to: '2026-09-17' },
      { from: '2026-09-18', to: '2026-09-27' },
    ]);
    expect(daySegments('2026-09-01', '2026-09-01')).toEqual([{ from: '2026-09-01', to: '2026-09-01' }]);
  });
});

describe('CommissionReportRepository', () => {
  let db: ReturnType<typeof createMockDynamoDbService>;
  let repo: CommissionReportRepository;
  const sent = (): Sent[] => db.client.send.mock.calls.map((c: unknown[]) => c[0] as Sent);

  beforeEach(() => {
    db = createMockDynamoDbService();
    repo = new CommissionReportRepository(db as never);
  });

  it('reads Done jobs by visit start on the StatusScheduleIndex, slice by slice, to the end of each', async () => {
    db.client.send.mockImplementation(async (cmd: Sent) => {
      const from = cmd.input.ExpressionAttributeValues[':from'];
      if (from === '2026-09-01#' && !cmd.input.ExclusiveStartKey) return { Items: [{ id: 'd1' }], LastEvaluatedKey: { PK: 'x' } };
      if (from === '2026-09-01#') return { Items: [{ id: 'd2' }] };
      return { Items: [{ id: 'd3' }, { id: 'd1' }] };
    });
    const out = await repo.findDoneByVisitStart('2026-09-01', '2026-09-20');
    expect(out.items.map((i) => i.id).sort()).toEqual(['d1', 'd2', 'd3']);
    expect(out.truncated).toBe(false);

    const first = sent()[0].input;
    expect(first.IndexName).toBe('StatusScheduleIndex');
    expect(first.KeyConditionExpression).toBe('#pk = :pk AND #sk BETWEEN :from AND :to');
    expect(first.ExpressionAttributeNames).toMatchObject({ '#pk': 'GSI5PK', '#sk': 'GSI5SK', '#st': 'status' });
    expect(first.ExpressionAttributeValues).toMatchObject({ ':pk': 'STATUS#done', ':from': '2026-09-01#', ':to': '2026-09-16#~~', ':active': 'active' });
    expect(first.ProjectionExpression).toBeDefined();
    expect(Object.values(first.ExpressionAttributeNames)).toEqual(expect.arrayContaining(['commissionSnapshot', 'scheduledEndDate', 'customFields']));
    expect(sent().map((c) => c.input.ExpressionAttributeValues[':to'])).toContain('2026-09-20#~~');
  });

  it('reads Done jobs by creation on the StageIndex between two instants', async () => {
    db.client.send.mockResolvedValue({ Items: [] });
    await repo.findDoneByCreated('2026-08-31', '2026-09-02T23:59:59.999Z');
    const [only] = sent();
    expect(only.input.IndexName).toBe('StageIndex');
    expect(only.input.ExpressionAttributeNames).toMatchObject({ '#pk': 'GSI1PK', '#sk': 'GSI1SK' });
    expect(only.input.ExpressionAttributeValues).toMatchObject({ ':pk': 'STATUS#done', ':from': '2026-08-31', ':to': '2026-09-02T23:59:59.999Z~' });
  });

  it('stops a walk on its page budget and says the read is a floor', async () => {
    db.client.send.mockResolvedValue({ Items: [{ id: 'x' }], LastEvaluatedKey: { PK: 'more' } });
    const out = await repo.findDoneByVisitStart('2026-09-01', '2026-09-01');
    expect(out.truncated).toBe(true);
    expect(db.client.send).toHaveBeenCalledTimes(150);
  });

  it('a technician’s period: ASSIGN# rows off the TechIndex, then their Done, live deals by BatchGet', async () => {
    db.client.send.mockImplementation(async (cmd: Sent) => {
      if (cmd.input.IndexName === 'TechIndex') return { Items: [{ dealId: 'd1' }, { dealId: 'd2' }, { dealId: 'd3' }, { dealId: 'd1' }] };
      const keys = cmd.input.RequestItems[DEALS_TABLE].Keys as Array<{ PK: string }>;
      if (keys.length === 3) {
        return {
          Responses: {
            [DEALS_TABLE]: [
              { id: 'd1', superStatus: 'done', status: 'active' },
              { id: 'd2', superStatus: 'in_progress', status: 'active' },
            ],
          },
          UnprocessedKeys: { [DEALS_TABLE]: { Keys: [{ PK: 'DEAL#d3', SK: 'METADATA' }] } },
        };
      }
      return { Responses: { [DEALS_TABLE]: [{ id: 'd3', superStatus: 'done', status: 'deleted' }] } };
    });
    const out = await repo.findDoneByTech('ann', '2026-08-01', '2026-09-27');
    expect(out.items.map((i) => i.id)).toEqual(['d1']);
    const [query, batch, retry] = sent();
    expect(query.input).toMatchObject({
      IndexName: 'TechIndex',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :from AND :to',
      ExpressionAttributeValues: { ':pk': 'TECH#ann', ':from': '2026-08-01', ':to': '2026-09-27~' },
    });
    expect(batch.input.RequestItems[DEALS_TABLE].Keys).toHaveLength(3);
    expect(batch.input.RequestItems[DEALS_TABLE].ProjectionExpression).toBeDefined();
    expect(retry.input.RequestItems[DEALS_TABLE].Keys).toEqual([{ PK: 'DEAL#d3', SK: 'METADATA' }]);
  });
});
