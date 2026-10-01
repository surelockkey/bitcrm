import { TimelineEventType, type TimelineEntry } from '@bitcrm/types';
import { historyKey, mergeClientEvents } from 'src/contacts/contact-history.merge';

const ev = (timestamp: string, id: string, dealId?: string): TimelineEntry =>
  ({
    id,
    dealId: dealId as string,
    eventType: TimelineEventType.NOTE_ADDED,
    actorId: 'u',
    actorName: 'U',
    timestamp,
    details: {},
  }) as TimelineEntry;

const keys = (rows: { timestamp: string; id: string }[]) => rows.map((r) => historyKey(r));

/**
 * The client card's History is one newest-first list, but it comes from two
 * places: the jobs' events (GSI10, paged by DynamoDB) and the import's few
 * client-level events (CLIENT#<id> partition, read whole every time). The
 * merge slots the client-level rows into whichever page their time falls in,
 * exactly once — the previous page's last key is the exclusive upper bound,
 * the current page's last key the inclusive lower bound (unless this is the
 * last page, which takes everything older).
 */
describe('mergeClientEvents', () => {
  const page = [ev('2026-09-10T00:00:00Z', 'p1', 'd1'), ev('2026-09-05T00:00:00Z', 'p2', 'd1'), ev('2026-09-01T00:00:00Z', 'p3', 'd2')];
  const client = [
    ev('2026-09-20T00:00:00Z', 'c-new'), // newer than everything
    ev('2026-09-03T00:00:00Z', 'c-mid'), // between p2 and p3
    ev('2020-01-01T00:00:00Z', 'c-created'), // older than everything (Created client)
  ];

  it('first page with more to come: takes the client rows down to the page’s oldest event', () => {
    const merged = mergeClientEvents(page, client, { hasMore: true });
    expect(keys(merged)).toEqual(keys([client[0], page[0], page[1], client[1], page[2]]));
  });

  it('a later page excludes what the previous page already showed (its last key is the bound)', () => {
    const merged = mergeClientEvents(page, client, { after: historyKey(ev('2026-09-12T00:00:00Z', 'x')), hasMore: true });
    expect(keys(merged)).toEqual(keys([page[0], page[1], client[1], page[2]]));
  });

  it('the last page takes every remaining client row, the "Created client" at the very bottom', () => {
    const merged = mergeClientEvents(page, client, { after: historyKey(ev('2026-09-12T00:00:00Z', 'x')), hasMore: false });
    expect(keys(merged)).toEqual(keys([page[0], page[1], client[1], page[2], client[2]]));
  });

  it('an empty last page still surfaces the client rows left over', () => {
    const merged = mergeClientEvents([], client, { after: historyKey(page[2]), hasMore: false });
    expect(keys(merged)).toEqual(keys([client[2]]));
  });

  it('an empty page that is not the last adds nothing (nothing to bound it by)', () => {
    expect(mergeClientEvents([], client, { after: historyKey(page[2]), hasMore: true })).toEqual([]);
  });

  it('no client rows: the page is returned as is', () => {
    expect(mergeClientEvents(page, [], { hasMore: true })).toEqual(page);
  });

  it('orders by the same key GSI10 sorts on — timestamp, then id', () => {
    expect(historyKey({ timestamp: '2026-09-01T00:00:00.000Z', id: 'abc' })).toBe('2026-09-01T00:00:00.000Z#abc');
  });
});
