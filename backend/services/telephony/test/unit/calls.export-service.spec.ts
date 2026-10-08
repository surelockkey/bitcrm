import { CallsExportService } from '../../src/calls/calls-export.service';
import { type CallRecord } from '../../src/calls/calls.repository';
import { type EnrichedCall } from '../../src/calls/party-resolver';

/**
 * «Export» обходить журнал тими самими фільтрами, сторінка за сторінкою, і
 * пише кожну сторінку одразу — файл не збирається в пам'яті. Імена — тим
 * самим шляхом, що й список; номери ховаються без contacts.view_numbers;
 * гроші — лише з financials.view. Довідник, що не відповів, коштує свого
 * стовпця, а не файлу.
 */

const rec = (sid: string, over: Partial<CallRecord> = {}): CallRecord => ({
  callSid: sid,
  direction: 'inbound',
  status: 'completed',
  from: '+18572949311',
  to: '+12034036303',
  answeredAt: '2026-10-08T19:15:05.000Z',
  startedAt: '2026-10-08T19:15:00.000Z',
  updatedAt: '2026-10-08T19:16:00.000Z',
  ...over,
});

function make(pages: Array<{ items: CallRecord[]; nextCursor?: string }>, over: Record<string, unknown> = {}) {
  let i = 0;
  const calls = {
    list: jest.fn(async () => pages[Math.min(i++, pages.length - 1)]),
  };
  const callTags = { byId: jest.fn(async () => new Map([['t1', { id: 't1', name: 'WRONG NUMBER', active: true }]])) };
  const dealNumbers = { numbers: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `N-${id}`]))) };
  const jobSources = { names: jest.fn(async () => new Map([['s1', 'SURE CT GMB']])) };
  const dealTotals = { totals: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, 10]))) };
  const deps = { calls, callTags, dealNumbers, jobSources, dealTotals, ...over };
  const service = new CallsExportService(
    deps.calls as never,
    deps.callTags as never,
    deps.dealNumbers as never,
    deps.jobSources as never,
    deps.dealTotals as never,
  );
  const lines: string[] = [];
  const sink = { write: jest.fn(async (chunk: string) => void lines.push(...chunk.split('\n').filter(Boolean))) };
  const name = jest.fn(async (items: CallRecord[]): Promise<EnrichedCall[]> =>
    items.map((c) => ({ ...c, fromParty: { kind: 'contact' as const, id: 'c1', name: 'Jane Roe' } })),
  );
  return { service, deps, sink, lines, name };
}

const opts = (over: Record<string, unknown> = {}) => ({
  money: true,
  maySeeNumbers: true,
  authorization: 'Bearer tok',
  ...over,
});

describe('CallsExportService.stream', () => {
  it('writes the header, then every page the walk returns, until there is no cursor', async () => {
    const { service, deps, sink, lines, name } = make([
      { items: [rec('CA1'), rec('CA2')], nextCursor: 'c2' },
      { items: [], nextCursor: 'c3' },
      { items: [rec('CA3')] },
    ]);

    const out = await service.stream({ dateFrom: '2026-10-08' }, { ...opts(), name }, sink);

    expect(lines[0]).toBe('Status,From,To,Time,Call Flow,Ad Source,Tags,Answered By,Jobs & Leads,Revenue');
    expect(lines).toHaveLength(4);
    expect(out).toEqual({ rows: 3, truncated: false });
    expect(deps.calls.list.mock.calls.map((c: unknown[]) => c[1])).toEqual([undefined, 'c2', 'c3']);
    // Same filter on every page, in pages of 100.
    expect(deps.calls.list.mock.calls.every((c: unknown[]) => (c[0] as { dateFrom: string }).dateFrom === '2026-10-08' && c[2] === 100)).toBe(true);
  });

  it('names the rows the way the list does', async () => {
    const { service, sink, lines, name } = make([{ items: [rec('CA1')] }]);

    await service.stream({}, { ...opts(), name }, sink);

    expect(name).toHaveBeenCalledTimes(1);
    expect(lines[1]).toContain('Jane Roe (857) 294-9311');
  });

  it('withholds the numbers from a viewer without contacts.view_numbers', async () => {
    const { service, sink, lines, name } = make([{ items: [rec('CA1')] }]);

    await service.stream({}, { ...opts({ maySeeNumbers: false }), name }, sink);

    expect(lines[1]).toContain('Jane Roe');
    expect(lines[1]).not.toContain('294-9311');
    expect(lines[1]).not.toContain('403-6303');
  });

  it('prints job numbers through deal-service as the viewer, sources and tags by name', async () => {
    const { service, deps, sink, lines, name } = make([
      { items: [rec('CA1', { dealId: 'd1', sourceId: 's1', tagIds: ['t1'] }), rec('CA2', { dealId: 'd1' })] },
    ]);

    await service.stream({}, { ...opts(), name }, sink);

    expect(deps.dealNumbers.numbers).toHaveBeenCalledWith(['d1'], 'Bearer tok');
    expect(lines[1]).toContain('SURE CT GMB');
    expect(lines[1]).toContain('WRONG NUMBER');
    expect(lines[1]).toContain('Job N-d1');
    expect(lines[1].endsWith(',10.00')).toBe(true);
  });

  it('asks for each deal once across pages', async () => {
    const { service, deps, sink, name } = make([
      { items: [rec('CA1', { dealId: 'd1' })], nextCursor: 'c2' },
      { items: [rec('CA2', { dealId: 'd1' }), rec('CA3', { dealId: 'd2' })] },
    ]);

    await service.stream({}, { ...opts(), name }, sink);

    expect(deps.dealNumbers.numbers.mock.calls.map((c: unknown[]) => c[0])).toEqual([['d1'], ['d2']]);
    expect(deps.dealTotals.totals.mock.calls.map((c: unknown[]) => c[0])).toEqual([['d1'], ['d2']]);
  });

  it('no money → no Revenue column and no totals asked for', async () => {
    const { service, deps, sink, lines, name } = make([{ items: [rec('CA1', { dealId: 'd1' })] }]);

    await service.stream({}, { ...opts({ money: false }), name }, sink);

    expect(lines[0].endsWith('Jobs & Leads')).toBe(true);
    expect(deps.dealTotals.totals).not.toHaveBeenCalled();
  });

  it('a lookup that fails costs its column, not the file', async () => {
    const { service, sink, lines, name } = make([{ items: [rec('CA1', { dealId: 'd1', sourceId: 's1', tagIds: ['t1'] })] }], {
      dealNumbers: { numbers: jest.fn().mockRejectedValue(new Error('403')) },
      jobSources: { names: jest.fn().mockRejectedValue(new Error('down')) },
      callTags: { byId: jest.fn().mockRejectedValue(new Error('down')) },
      dealTotals: { totals: jest.fn().mockRejectedValue(new Error('down')) },
    });

    const out = await service.stream({}, { ...opts(), name }, sink);

    expect(out.rows).toBe(1);
    expect(lines[1].startsWith('Incoming call,Jane Roe')).toBe(true);
    expect(lines[1]).not.toContain('Job');
  });

  it('stops at the row cap and says so', async () => {
    const { service, sink, name } = make([{ items: [rec('CA1'), rec('CA2'), rec('CA3')], nextCursor: 'more' }]);

    const out = await service.stream({}, { ...opts(), name, maxRows: 5 }, sink);

    expect(out).toEqual({ rows: 5, truncated: true });
  });
});
