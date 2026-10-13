import { DynamoDbService } from '@bitcrm/shared';
import { CallsRepository, type CallRecord } from '../../src/calls/calls.repository';
import { CallsService } from '../../src/calls/calls.service';
import { CallDealEventsHandler, CALL_DEAL_EVENT_TYPES } from '../../src/calls/call-deal-events.handler';
import { DealTotalsClient } from '../../src/common/deal-totals.client';
import { planDealTotal, dealTotalOf } from '../../src/scripts/backfill-call-deal-totals';

/**
 * A linked call carries its job's total (`dealTotal`), so the call reports do
 * not ask deal-service for every job on every read. Written when the call is
 * linked, refreshed from deal-events; the calls of one job are found through a
 * small adjacency row per link, `DEALCALLS#<dealId>` / `CALL#<callSid>` — the
 * calls table's three GSIs are all taken (agent, log, party), and a fourth
 * index for this would cost every call write an extra index copy.
 */

function fakeClient(responses: Array<unknown> = []) {
  const sent: Array<{ name: string; input: Record<string, any> }> = [];
  let i = 0;
  const client = {
    send: jest.fn(async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      const res = responses[i] ?? {};
      i += 1;
      if (res instanceof Error) throw res;
      return res;
    }),
  };
  return { repo: new CallsRepository({ client } as unknown as DynamoDbService), sent, client };
}

const ccf = () => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });

describe('CallsRepository — the job link', () => {
  it('a new link drops the total of whatever job the call was on before', async () => {
    const { repo, sent } = fakeClient();

    await repo.setDeal('CA1', 'd2', 'u1');

    expect(sent[0].input.UpdateExpression).toMatch(/REMOVE .*#dealTotal/);
    expect(sent[0].input.ExpressionAttributeNames['#dealTotal']).toBe('dealTotal');
    expect(sent[0].input.ExpressionAttributeNames['#dealTotalAt']).toBe('dealTotalAt');
  });

  it('detaching drops the total too', async () => {
    const { repo, sent } = fakeClient();

    await repo.setDeal('CA1', null, 'u1');

    expect(sent[0].input.UpdateExpression).toMatch(/REMOVE .*#dealTotal/);
  });

  it('indexes the link as DEALCALLS#<dealId> / CALL#<sid> — no GSI keys, never in the log', async () => {
    const { repo, sent } = fakeClient();

    await repo.indexDealLink('d1', 'CA1');

    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toMatchObject({ PK: 'DEALCALLS#d1', SK: 'CALL#CA1', dealId: 'd1', callSid: 'CA1' });
    expect(Object.keys(sent[0].input.Item).some((k) => k.startsWith('GSI'))).toBe(false);
  });

  it('unindexes a link', async () => {
    const { repo, sent } = fakeClient();

    await repo.unindexDealLink('d1', 'CA1');

    expect(sent[0].name).toBe('DeleteCommand');
    expect(sent[0].input.Key).toEqual({ PK: 'DEALCALLS#d1', SK: 'CALL#CA1' });
  });

  it('lists the calls of a job off the adjacency partition, every page', async () => {
    const { repo, sent } = fakeClient([
      { Items: [{ SK: 'CALL#CA1' }, { SK: 'CALL#CA2' }], LastEvaluatedKey: { PK: 'x' } },
      { Items: [{ SK: 'CALL#CA3' }] },
    ]);

    await expect(repo.callSidsForDeal('d1')).resolves.toEqual(['CA1', 'CA2', 'CA3']);
    expect(sent[0].input.KeyConditionExpression).toContain('PK = :pk');
    expect(sent[0].input.ExpressionAttributeValues[':pk']).toBe('DEALCALLS#d1');
    expect(sent[0].input.IndexName).toBeUndefined();
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'x' });
  });

  it('stamps a total only while the call is still on that job, and never over a newer read', async () => {
    const { repo, sent } = fakeClient();

    await expect(repo.setDealTotal('CA1', 'd1', 120.5, '2026-10-13T10:00:00.000Z')).resolves.toBe(true);

    const input = sent[0].input;
    expect(input.UpdateExpression).toContain('#dealTotal = :total');
    expect(input.ConditionExpression).toContain('#dealId = :dealId');
    expect(input.ConditionExpression).toContain('#dealTotalAt <= :at');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':dealId': 'd1', ':total': 120.5, ':at': '2026-10-13T10:00:00.000Z' });
  });

  it('a call moved to another job (or an unchanged total) is not an error — just no write', async () => {
    const { repo } = fakeClient([ccf()]);

    await expect(repo.setDealTotal('CA1', 'd1', 1, '2026-10-13T10:00:00.000Z')).resolves.toBe(false);
  });
});

describe('CallsService — the total follows the link', () => {
  const rec = (over: Partial<CallRecord> = {}): CallRecord => ({
    callSid: 'CA1',
    startedAt: '2026-10-13T09:00:00.000Z',
    updatedAt: '2026-10-13T09:00:00.000Z',
    ...over,
  });

  function make(before: CallRecord | null, total: number | Error = 250) {
    const repo = {
      getBySid: jest.fn().mockResolvedValueOnce(before).mockResolvedValue(before ? { ...before } : null),
      setDeal: jest.fn().mockResolvedValue(undefined),
      indexDealLink: jest.fn().mockResolvedValue(undefined),
      unindexDealLink: jest.fn().mockResolvedValue(undefined),
      setDealTotal: jest.fn().mockResolvedValue(true),
      callSidsForDeal: jest.fn().mockResolvedValue(['CA1', 'CA2']),
    };
    const totals = {
      totalOf: jest.fn(async () => {
        if (total instanceof Error) throw total;
        return total;
      }),
    };
    const service = new CallsService(
      repo as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      totals as never,
    );
    return { service, repo, totals };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it('linking indexes the call under the job and stamps the job’s total', async () => {
    const { service, repo, totals } = make(rec());

    await service.linkDeal('CA1', 'd1', { id: 'u1' });
    await flush();

    expect(repo.indexDealLink).toHaveBeenCalledWith('d1', 'CA1');
    expect(totals.totalOf).toHaveBeenCalledWith('d1');
    expect(repo.setDealTotal).toHaveBeenCalledWith('CA1', 'd1', 250, expect.any(String));
  });

  it('moving a call to another job moves its index row', async () => {
    const { service, repo } = make(rec({ dealId: 'd0' }));

    await service.linkDeal('CA1', 'd1', { id: 'u1' });
    await flush();

    expect(repo.unindexDealLink).toHaveBeenCalledWith('d0', 'CA1');
    expect(repo.indexDealLink).toHaveBeenCalledWith('d1', 'CA1');
  });

  it('detaching removes the index row and stamps nothing', async () => {
    const { service, repo, totals } = make(rec({ dealId: 'd0' }));

    await service.linkDeal('CA1', null, { id: 'u1' });
    await flush();

    expect(repo.unindexDealLink).toHaveBeenCalledWith('d0', 'CA1');
    expect(repo.indexDealLink).not.toHaveBeenCalled();
    expect(totals.totalOf).not.toHaveBeenCalled();
  });

  it('deal-service failing leaves the total unset — the link itself stands', async () => {
    const { service, repo } = make(rec(), new Error('down'));

    await expect(service.linkDeal('CA1', 'd1', { id: 'u1' })).resolves.toBeTruthy();
    await flush();

    expect(repo.setDeal).toHaveBeenCalled();
    expect(repo.setDealTotal).not.toHaveBeenCalled();
  });

  it('an index write failing never fails the link', async () => {
    const { service, repo } = make(rec());
    repo.indexDealLink.mockRejectedValueOnce(new Error('throttled'));

    await expect(service.linkDeal('CA1', 'd1', { id: 'u1' })).resolves.toBeTruthy();
  });

  it('refreshDealTotals re-reads the total once and stamps every linked call', async () => {
    const { service, repo, totals } = make(rec(), 99.9);

    await expect(service.refreshDealTotals('d1')).resolves.toBe(2);

    expect(totals.totalOf).toHaveBeenCalledTimes(1);
    expect(repo.setDealTotal).toHaveBeenCalledWith('CA1', 'd1', 99.9, expect.any(String));
    expect(repo.setDealTotal).toHaveBeenCalledWith('CA2', 'd1', 99.9, expect.any(String));
  });

  it('a job with no calls costs one adjacency read and no deal-service call', async () => {
    const { service, repo, totals } = make(rec());
    repo.callSidsForDeal.mockResolvedValueOnce([]);

    await expect(service.refreshDealTotals('d1')).resolves.toBe(0);
    expect(totals.totalOf).not.toHaveBeenCalled();
  });

  it('deal-service failing during a refresh throws, so SQS retries the event', async () => {
    const { service } = make(rec(), new Error('down'));

    await expect(service.refreshDealTotals('d1')).rejects.toThrow('down');
  });
});

describe('CallDealEventsHandler', () => {
  const OLD = process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL;
  afterEach(() => {
    if (OLD === undefined) delete process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL;
    else process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL = OLD;
  });

  it('consumes the events that move a job’s total — the set billing refreshes invoices on', () => {
    expect([...CALL_DEAL_EVENT_TYPES].sort()).toEqual(
      [
        'deal.deleted',
        'deal.product_added',
        'deal.product_removed',
        'deal.product_updated',
        'deal.products_replaced',
        'deal.status_changed',
        'deal.updated',
      ].sort(),
    );
  });

  it('registers only when its queue is configured', () => {
    const consumer = { registerHandler: jest.fn() };
    delete process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL;
    new CallDealEventsHandler({} as never, consumer as never).onModuleInit();
    expect(consumer.registerHandler).not.toHaveBeenCalled();

    process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL = 'http://q';
    new CallDealEventsHandler({} as never, consumer as never).onModuleInit();
    expect(consumer.registerHandler).toHaveBeenCalledTimes(CALL_DEAL_EVENT_TYPES.length);
  });

  it('refreshes the totals of the event’s job, and rethrows a failure for SQS to retry', async () => {
    const calls = { refreshDealTotals: jest.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('down')) };
    const handler = new CallDealEventsHandler(calls as never);

    await handler.handle('deal.updated', { dealId: 'd1' });
    expect(calls.refreshDealTotals).toHaveBeenCalledWith('d1');
    await expect(handler.handle('deal.updated', { dealId: 'd1' })).rejects.toThrow('down');
  });

  it('an event with no dealId is dropped', async () => {
    const calls = { refreshDealTotals: jest.fn() };
    await new CallDealEventsHandler(calls as never).handle('deal.updated', {});
    expect(calls.refreshDealTotals).not.toHaveBeenCalled();
  });
});

describe('DealTotalsClient.totalOf', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('one job’s total through the batch route; an unknown (deleted) job is 0', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { d1: 12.5 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) }) as never;

    await expect(new DealTotalsClient().totalOf('d1')).resolves.toBe(12.5);
    await expect(new DealTotalsClient().totalOf('gone')).resolves.toBe(0);
  });
});

describe('backfill:call-deal-totals — the plan', () => {
  const totals = new Map([['d1', 120]]);

  it('a linked call with no total gets the job’s', () => {
    expect(planDealTotal({ PK: 'CALL#CA1', dealId: 'd1' }, totals, false)).toEqual({ action: 'set', dealId: 'd1', total: 120 });
  });

  it('a job the deals table no longer holds is 0, as the reports count it', () => {
    expect(planDealTotal({ PK: 'CALL#CA1', dealId: 'gone' }, totals, false)).toEqual({ action: 'set', dealId: 'gone', total: 0 });
  });

  it('a stamped total is left alone, unless --refresh and it differs', () => {
    expect(planDealTotal({ PK: 'CALL#CA1', dealId: 'd1', dealTotal: 99 }, totals, false)).toEqual({ action: 'skip' });
    expect(planDealTotal({ PK: 'CALL#CA1', dealId: 'd1', dealTotal: 99 }, totals, true)).toEqual({ action: 'set', dealId: 'd1', total: 120 });
    expect(planDealTotal({ PK: 'CALL#CA1', dealId: 'd1', dealTotal: 120 }, totals, true)).toEqual({ action: 'skip' });
  });

  it('no job → nothing', () => {
    expect(planDealTotal({ PK: 'CALL#CA1' }, totals, true)).toEqual({ action: 'skip' });
  });

  it('reads a job’s total the way deal-service does', () => {
    expect(dealTotalOf({ totals: { total: 10 }, jobTotalPrice: 5 })).toBe(10);
    expect(dealTotalOf({ jobTotalPrice: 5 })).toBe(5);
    expect(dealTotalOf({})).toBe(0);
    expect(dealTotalOf(undefined)).toBe(0);
  });
});
