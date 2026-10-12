import { DynamoDbService } from '@bitcrm/shared';
import { CallsRepository } from '../../src/calls/calls.repository';
import { callFlowSeries, TOP_FLOWS } from '../../src/calls/call-flow-series';

/**
 * «Top Call Flows» на дашборді — скільки дзвінків щодня пройшло кожним
 * call flow. Лінія на flow, тож у серії кожен день вікна, нулі включно:
 * пропущений день зламав би лінію.
 */
describe('callFlowSeries', () => {
  const window = { from: '2026-09-14', to: '2026-09-16' };

  it('a line per flow, a point per day, zeros where nobody called', () => {
    const out = callFlowSeries({ 'SURE TX': { '2026-09-14': 3, '2026-09-16': 1 } }, window, false);

    expect(out).toEqual({
      days: ['2026-09-14', '2026-09-15', '2026-09-16'],
      flows: [{ name: 'SURE TX', counts: [3, 0, 1] }],
      atLeast: false,
    });
  });

  it('busiest flow first; ties by name', () => {
    const out = callFlowSeries(
      {
        B: { '2026-09-14': 2 },
        A: { '2026-09-14': 2 },
        C: { '2026-09-15': 9 },
      },
      window,
      false,
    );

    expect(out.flows.map((f) => f.name)).toEqual(['C', 'A', 'B']);
  });

  it(`keeps the ${TOP_FLOWS} busiest — a legend of forty flows is not a chart`, () => {
    const tally = Object.fromEntries(
      Array.from({ length: TOP_FLOWS + 3 }, (_, i) => [`F${String(i).padStart(2, '0')}`, { '2026-09-14': i + 1 }]),
    );

    const out = callFlowSeries(tally, window, false);

    expect(out.flows).toHaveLength(TOP_FLOWS);
    expect(out.flows[0].name).toBe(`F${String(TOP_FLOWS + 2).padStart(2, '0')}`);
  });

  it('a day outside the window is not drawn', () => {
    const out = callFlowSeries({ A: { '2026-09-13': 5, '2026-09-14': 1 } }, window, false);

    expect(out.flows[0].counts).toEqual([1, 0, 0]);
  });

  it('carries atLeast through', () => {
    expect(callFlowSeries({}, window, true).atLeast).toBe(true);
  });
});

describe('CallsRepository.flowCallsByDay', () => {
  function makeRepo(pages: Array<{ Items: unknown[]; LastEvaluatedKey?: unknown }>) {
    const sent: Array<{ input: Record<string, any> }> = [];
    let i = 0;
    const client = {
      send: jest.fn(async (cmd: { input: Record<string, any> }) => {
        sent.push(cmd);
        const res = pages[Math.min(i, pages.length - 1)] ?? { Items: [] };
        i += 1;
        return res;
      }),
    };
    return { repo: new CallsRepository({ client } as unknown as DynamoDbService), sent };
  }

  it('tallies calls by flow and by the day they started', async () => {
    const { repo } = makeRepo([
      {
        Items: [
          { flowName: 'SURE TX', startedAt: '2026-09-14T10:00:00.000Z' },
          { flowName: 'SURE TX', startedAt: '2026-09-14T11:00:00.000Z' },
          { flowName: 'SURE CT', startedAt: '2026-09-15T09:00:00.000Z' },
        ],
      },
    ]);

    const out = await repo.flowCallsByDay({ from: '2026-09-14', to: '2026-09-15' });

    expect(out).toEqual({
      byFlow: { 'SURE TX': { '2026-09-14': 2 }, 'SURE CT': { '2026-09-15': 1 } },
      atLeast: false,
    });
  });

  it('reads only the two attributes it tallies, and only calls that went through a flow', async () => {
    const { repo, sent } = makeRepo([{ Items: [] }]);

    await repo.flowCallsByDay({ from: '2026-09-14', to: '2026-09-15' });

    const input = sent[0].input;
    expect(input.ProjectionExpression).toContain('flowName');
    expect(input.ProjectionExpression).toContain('startedAt');
    expect(input.FilterExpression).toContain('attribute_exists(flowName)');
    expect(input.FilterExpression).toContain('attribute_not_exists(internalLegOf)');
  });

  it('walks each month of the window, bounded to its Connecticut days as instants', async () => {
    const { repo, sent } = makeRepo([{ Items: [] }]);

    await repo.flowCallsByDay({ from: '2026-08-25', to: '2026-09-05' });

    expect(sent.map((c) => c.input.ExpressionAttributeValues[':allPk'])).toEqual(['CALL#2026-09', 'CALL#2026-08']);
    // Aug 25 00:00 EDT .. the last millisecond of Sep 5 EDT — not the UTC days.
    expect(sent[0].input.ExpressionAttributeValues[':skFrom']).toBe('2026-08-25T04:00:00.000Z');
    expect(sent[0].input.ExpressionAttributeValues[':skTo'].startsWith('2026-09-06T03:59:59.999Z')).toBe(true);
  });

  it('a window ending on the last of a month reads the next UTC month too — its evening is there', async () => {
    const { repo, sent } = makeRepo([{ Items: [] }]);

    await repo.flowCallsByDay({ from: '2026-09-30', to: '2026-09-30' });

    expect(sent.map((c) => c.input.ExpressionAttributeValues[':allPk'])).toEqual(['CALL#2026-10', 'CALL#2026-09']);
  });

  it('puts each call on its Connecticut day, never its UTC prefix', async () => {
    const { repo } = makeRepo([
      {
        Items: [
          // 22:30 EDT on Sep 14 is 02:30 UTC on Sep 15.
          { flowName: 'SURE CT', startedAt: '2026-09-15T02:30:00.000Z' },
          // Winter: 23:00 EST on Jan 15 is 04:00 UTC on Jan 16.
          { flowName: 'SURE CT', startedAt: '2026-01-16T04:00:00.000Z' },
        ],
      },
    ]);

    const out = await repo.flowCallsByDay({ from: '2026-01-15', to: '2026-01-15' });

    expect(out.byFlow).toEqual({ 'SURE CT': { '2026-09-14': 1, '2026-01-15': 1 } });
  });

  it('out of budget, the tally is a floor', async () => {
    const { repo } = makeRepo([{ Items: [], LastEvaluatedKey: { k: 1 } }]);

    const out = await repo.flowCallsByDay({ from: '2026-09-14', to: '2026-09-15' });

    expect(out.atLeast).toBe(true);
  });
});
