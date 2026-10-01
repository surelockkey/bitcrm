/**
 * What the Items and services report reads from DynamoDB: the Done jobs of
 * its window (StatusScheduleIndex, `STATUS#done` only) and each job's
 * `PRODUCT#` lines (one Query per job, bounded parallelism, never a Scan).
 */
import { JobSuperStatus } from '@bitcrm/types';
import { DealsRepository } from '../../../../src/deals/deals.repository';
import { ItemsReportRepository, LINES_PARALLEL } from '../../../../src/deals/report/items-report.repository';
import { ITEMS_DEAL_PROJECTION, ITEMS_LINE_PROJECTION } from '../../../../src/deals/report/items-report.logic';
import { createMockDynamoDbService } from '../../mocks';

describe('DealsRepository.readReportWindow — only some statuses', () => {
  it('by scheduled with Done only: the Done partitions of the schedule index, nothing else', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await new DealsRepository(dynamoDb as any).readReportWindow('scheduled', '2026-09-01', '2026-09-27', ITEMS_DEAL_PROJECTION, {
      statuses: [JobSuperStatus.DONE],
    });
    const q = dynamoDb.client.send.mock.calls.map((c: any[]) => c[0].input);
    // Aug 31, Sep 1–28 and the undated ones — Done each.
    expect(q).toHaveLength(3);
    expect(new Set(q.map((i: any) => i.ExpressionAttributeValues[':pk']))).toEqual(new Set(['STATUS#done']));
    expect(new Set(q.map((i: any) => i.IndexName))).toEqual(new Set(['StatusScheduleIndex']));
  });

  it('without the option every status is read, as the Jobs report needs', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await new DealsRepository(dynamoDb as any).readReportWindow('scheduled', '2026-09-01', '2026-09-27', ITEMS_DEAL_PROJECTION);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(18);
  });
});

describe('ItemsReportRepository.linesOf', () => {
  it("one Query per job on its own partition, begins_with PRODUCT#, projected, paged to the end", async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const { ':pk': pk } = cmd.input.ExpressionAttributeValues;
      if (pk === 'DEAL#d1' && !cmd.input.ExclusiveStartKey) return { Items: [{ SK: 'PRODUCT#1' }], LastEvaluatedKey: { PK: pk, SK: 'PRODUCT#1' } };
      if (pk === 'DEAL#d1') return { Items: [{ SK: 'PRODUCT#2' }] };
      if (pk === 'DEAL#d2') return { Items: [] };
      return { Items: [{ SK: 'PRODUCT#9' }] };
    });
    const lines = await new ItemsReportRepository(dynamoDb as any).linesOf(['d1', 'd2', 'd3', 'd1', ''], ITEMS_LINE_PROJECTION);

    expect([...lines.keys()].sort()).toEqual(['d1', 'd3']);
    expect(lines.get('d1')!.map((r) => r.SK)).toEqual(['PRODUCT#1', 'PRODUCT#2']);
    const inputs = dynamoDb.client.send.mock.calls.map((c: any[]) => c[0].input);
    expect(inputs).toHaveLength(4);
    for (const i of inputs) {
      expect(i.IndexName).toBeUndefined();
      expect(i.KeyConditionExpression).toBe('#pk = :pk AND begins_with(#sk, :sk)');
      expect(i.ExpressionAttributeValues[':sk']).toBe('PRODUCT#');
      expect(i.ProjectionExpression.split(', ')).toHaveLength(ITEMS_LINE_PROJECTION.length);
    }
    expect(dynamoDb.client.send.mock.calls.every((c: any[]) => c[0].constructor.name === 'QueryCommand')).toBe(true);
  });

  it(`never more than ${LINES_PARALLEL} jobs at once`, async () => {
    const dynamoDb = createMockDynamoDbService();
    let inFlight = 0;
    let peak = 0;
    dynamoDb.client.send.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { Items: [{ SK: 'PRODUCT#x' }] };
    });
    const ids = Array.from({ length: 200 }, (_, i) => `d${i}`);
    const lines = await new ItemsReportRepository(dynamoDb as any).linesOf(ids, ITEMS_LINE_PROJECTION);
    expect(lines.size).toBe(200);
    expect(peak).toBeLessThanOrEqual(LINES_PARALLEL);
    expect(peak).toBeGreaterThan(1);
  });

  it('asks nothing for no jobs', async () => {
    const dynamoDb = createMockDynamoDbService();
    await expect(new ItemsReportRepository(dynamoDb as any).linesOf([], ITEMS_LINE_PROJECTION)).resolves.toEqual(new Map());
    expect(dynamoDb.client.send).not.toHaveBeenCalled();
  });
});
