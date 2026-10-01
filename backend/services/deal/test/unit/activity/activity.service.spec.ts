import { BadRequestException } from '@nestjs/common';
import { ActivityService, decodeCursor, encodeCursor } from 'src/activity/activity.service';
import { ActivityController } from 'src/activity/activity.controller';

const workizRow = (n: number) => ({
  PK: 'DEAL#d1',
  SK: `TIMELINE#2026-09-01T14:00:0${n}.600Z#w${n}`,
  id: `w${n}`,
  dealId: 'd1',
  eventType: 'field_updated',
  actorId: 'u1',
  actorName: '(1) (Tom) 4 Dispatcher',
  timestamp: `2026-09-01T14:00:0${n}.600Z`,
  source: 'workiz',
  externalId: `workiz:activity:${n}:0`,
  details: { source: 'workiz', workiz: { text: 'Update job details', jobUuid: 'EBKZ0I', native: false } },
});

const nativeRow = {
  PK: 'DEAL#d2',
  SK: 'TIMELINE#2026-09-30T14:00:00.000Z#n1',
  id: 'n1',
  dealId: 'd2',
  eventType: 'created',
  actorId: 'u2',
  actorName: 'dana@x.com',
  timestamp: '2026-09-30T14:00:00.000Z',
  details: {},
  activitySource: 'web',
};

function build(pages: Array<{ items: Record<string, unknown>[]; next?: unknown }> = [{ items: [nativeRow, workizRow(1)] }]) {
  const repo = {
    page: jest.fn(async () => pages.shift() ?? { items: [] }),
    count: jest.fn(async () => ({ total: 35, atLeast: false })),
    dealNumbers: jest.fn(async () => new Map([['d2', 'AB12CD']])),
    dealIdByNumber: jest.fn(async () => undefined as string | undefined),
  };
  const counts = { sum: jest.fn(async (_days: string[]) => 130964) };
  const svc = new ActivityService(repo as never, counts as never);
  return { svc, repo, counts };
}

describe('ActivityService', () => {
  it('prints native and imported rows, naming a native event’s job by its deal number', async () => {
    const { svc, repo } = build();
    const out = await svc.list({ from: '2026-09-01', to: '2026-09-30' });

    expect(out.items.map((r) => [r.text, r.jobRef, r.source, r.imported])).toEqual([
      ['Created Job', 'AB12CD', 'web', false],
      ['Update job details', 'EBKZ0I', 'web', true],
    ]);
    // Only the native event needed a lookup.
    expect(repo.dealNumbers).toHaveBeenCalledWith(['d2']);
    expect(repo.page).toHaveBeenCalledWith(expect.objectContaining({ sort: 'desc', limit: 10 }));
  });

  it('passes the search lower-cased, with the deal a job code names', async () => {
    const { svc, repo } = build();
    repo.dealIdByNumber.mockResolvedValueOnce('d1');
    await svc.list({ from: '2026-09-01', to: '2026-09-27', q: ' EBKZ0I ', userIds: 'u1, u2,u1', sort: 'asc', limit: 25 });
    expect(repo.page).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'ebkz0i', qDealId: 'd1', userIds: ['u1', 'u2'], sort: 'asc', limit: 25 }),
    );
  });

  it('round-trips its cursor and refuses a forged one', () => {
    const cursor = { d: '2026-09-02', k: { PK: 'DEAL#d1' } };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(() => decodeCursor('%%%')).toThrow(BadRequestException);
  });

  it('totals an unfiltered period off the day counters', async () => {
    const { svc, repo, counts } = build();
    await expect(svc.count({ from: '2026-09-01', to: '2026-09-27' })).resolves.toEqual({ total: 130964, atLeast: false });
    expect(counts.sum.mock.calls[0][0]).toHaveLength(27);
    expect(repo.count).not.toHaveBeenCalled();
  });

  it('counts a searched or narrowed period by walking it', async () => {
    const { svc, repo } = build();
    await expect(svc.count({ from: '2026-09-01', to: '2026-09-27', q: 'Logged In' })).resolves.toEqual({ total: 35, atLeast: false });
    expect(repo.count).toHaveBeenCalledWith(expect.objectContaining({ q: 'logged in' }));
  });

  it('exports every page up to the ceiling', async () => {
    const { svc, repo } = build([
      { items: [workizRow(1), workizRow(2)], next: { d: '2026-09-01' } },
      { items: [workizRow(3)] },
    ]);
    const out = await svc.export({ from: '2026-09-01', to: '2026-09-27' });
    expect(out.rows).toHaveLength(3);
    expect(out.truncated).toBe(false);
    expect(repo.page).toHaveBeenCalledTimes(2);
    expect(repo.page).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, cursor: { d: '2026-09-01' } }));
  });

  it('refuses a backwards period or too many people', async () => {
    const { svc } = build();
    await expect(svc.list({ from: '2026-09-27', to: '2026-09-01' })).rejects.toBeInstanceOf(BadRequestException);
    const many = Array.from({ length: 21 }, (_, i) => `u${i}`).join(',');
    await expect(svc.list({ from: '2026-09-01', to: '2026-09-27', userIds: many })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ActivityController', () => {
  it('answers a page in the list envelope', async () => {
    const svc = { list: jest.fn(async () => ({ items: [{ id: 'a' }], nextCursor: 'c1' })) };
    const controller = new ActivityController(svc as never);
    await expect(controller.list({ from: '2026-09-01', to: '2026-09-01' })).resolves.toEqual({
      success: true,
      data: [{ id: 'a' }],
      pagination: { nextCursor: 'c1', count: 1 },
    });
  });
});
