import { DealTotalsRepository, dealTotalOf } from 'src/deal-totals/deal-totals.repository';
import { DealTotalsController } from 'src/deal-totals/deal-totals.controller';
import { createMockDynamoDbService } from '../mocks';

describe('Deal totals for Call Tracking revenue', () => {
  it('reads totals.total, else an imported job’s jobTotalPrice, else 0', () => {
    expect(dealTotalOf({ totals: { total: 230.85 }, jobTotalPrice: 999 })).toBe(230.85);
    expect(dealTotalOf({ jobTotalPrice: 120 })).toBe(120);
    expect(dealTotalOf({})).toBe(0);
  });

  it('batches 100 keys a request, projects three attributes and maps id → total', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockImplementation(async (cmd: { input: any }) => {
      const keys = Object.values(cmd.input.RequestItems)[0] as { Keys: { PK: string }[] };
      return {
        Responses: {
          BitCRM_Deals: keys.Keys.map((k) => ({ id: k.PK.slice(5), totals: { total: 1 } })),
        },
      };
    });
    const repo = new DealTotalsRepository(dynamoDb as any);
    const ids = Array.from({ length: 250 }, (_, i) => `d${i}`);

    const out = await repo.totalsOf([...ids, 'd0']);

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(3);
    const first = dynamoDb.client.send.mock.calls[0][0].input.RequestItems.BitCRM_Deals;
    expect(first.Keys).toHaveLength(100);
    expect(first.ProjectionExpression).toBe('#id, #totals, #jobTotalPrice');
    expect(Object.keys(out)).toHaveLength(250);
  });

  it('retries the keys DynamoDB left unprocessed', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send
      .mockResolvedValueOnce({
        Responses: { BitCRM_Deals: [{ id: 'a', totals: { total: 5 } }] },
        UnprocessedKeys: { BitCRM_Deals: { Keys: [{ PK: 'DEAL#b', SK: 'METADATA' }] } },
      })
      .mockResolvedValueOnce({ Responses: { BitCRM_Deals: [{ id: 'b', jobTotalPrice: 7 }] } });
    const repo = new DealTotalsRepository(dynamoDb as any);

    await expect(repo.totalsOf(['a', 'b'])).resolves.toEqual({ a: 5, b: 7 });
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
  });

  it('answers in the envelope', async () => {
    const repo = { totalsOf: jest.fn(async () => ({ a: 1 })) };
    const controller = new DealTotalsController(repo as any);
    await expect(controller.totals({ ids: ['a'] })).resolves.toEqual({ success: true, data: { a: 1 } });
  });
});
