import { TimelineEventType } from '@bitcrm/types';
import { ContactHistoryService } from 'src/contacts/contact-history.service';
import { createMockDeal, createMockTimelineEntry } from '../mocks';

const decode = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));

/**
 * `GET /deals/timeline/by-contact/:contactId` — every event of the client's
 * jobs plus the import's client-level rows, newest first, each job event
 * labelled with its job number so the card can say "Job: NU8GUR".
 */
describe('ContactHistoryService', () => {
  let timeline: { findByContact: jest.Mock; findClientActivity: jest.Mock };
  let deals: { findByIds: jest.Mock };
  let service: ContactHistoryService;

  beforeEach(() => {
    timeline = {
      findByContact: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
      findClientActivity: jest.fn().mockResolvedValue([]),
    };
    deals = { findByIds: jest.fn().mockResolvedValue([]) };
    service = new ContactHistoryService(timeline as never, deals as never);
  });

  it('resolves the job numbers of the page in one batch of distinct ids', async () => {
    timeline.findByContact.mockResolvedValue({
      items: [
        createMockTimelineEntry({ id: 'e1', dealId: 'd1', timestamp: '2026-09-10T00:00:00.000Z' }),
        createMockTimelineEntry({ id: 'e2', dealId: 'd2', timestamp: '2026-09-09T00:00:00.000Z' }),
        createMockTimelineEntry({ id: 'e3', dealId: 'd1', timestamp: '2026-09-08T00:00:00.000Z' }),
      ],
      nextCursor: undefined,
    });
    deals.findByIds.mockResolvedValue([createMockDeal({ id: 'd1', dealNumber: 'NU8GUR' }), createMockDeal({ id: 'd2', dealNumber: 'AB12CD' })]);

    const page = await service.list('c1', 30);

    expect(timeline.findByContact).toHaveBeenCalledWith('c1', 30, undefined);
    expect(deals.findByIds).toHaveBeenCalledTimes(1);
    expect(deals.findByIds).toHaveBeenCalledWith(['d1', 'd2']);
    expect(page.items.map((e) => [e.id, e.dealId, e.dealNumber])).toEqual([
      ['e1', 'd1', 'NU8GUR'],
      ['e2', 'd2', 'AB12CD'],
      ['e3', 'd1', 'NU8GUR'],
    ]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('a job that no longer resolves leaves dealNumber out rather than failing the page', async () => {
    timeline.findByContact.mockResolvedValue({
      items: [createMockTimelineEntry({ id: 'e1', dealId: 'gone' })],
      nextCursor: undefined,
    });
    const page = await service.list('c1', 30);
    expect(page.items[0].dealId).toBe('gone');
    expect(page.items[0]).not.toHaveProperty('dealNumber');
  });

  it('folds the import’s client-level rows (created / deleted) into the right page, with no dealId', async () => {
    timeline.findByContact.mockResolvedValue({
      items: [createMockTimelineEntry({ id: 'e1', dealId: 'd1', timestamp: '2026-09-10T00:00:00.000Z' })],
      nextCursor: undefined,
    });
    timeline.findClientActivity.mockResolvedValue([
      {
        id: 'c-created',
        // The import's own type — not in our enum, rendered by the web as its `note`.
        eventType: 'workiz_activity' as unknown as TimelineEventType,
        actorId: 'workiz:unresolved',
        actorName: 'User A',
        timestamp: '2020-03-04T13:37:00.600Z',
        note: 'Created client',
        details: { kind: 'client_created', source: 'workiz' },
      },
    ]);

    const page = await service.list('c1', 30);

    expect(timeline.findClientActivity).toHaveBeenCalledWith('c1');
    expect(page.items.map((e) => e.id)).toEqual(['e1', 'c-created']);
    expect(page.items[1].dealId).toBeUndefined();
    expect(page.items[1]).not.toHaveProperty('dealNumber');
    // Only real jobs are looked up.
    expect(deals.findByIds).toHaveBeenCalledWith(['d1']);
  });

  it('the cursor carries both the index position and the merge bound, and the next call honours them', async () => {
    timeline.findByContact.mockResolvedValue({
      items: [
        createMockTimelineEntry({ id: 'e1', dealId: 'd1', timestamp: '2026-09-10T00:00:00.000Z' }),
        createMockTimelineEntry({ id: 'e2', dealId: 'd1', timestamp: '2026-09-05T00:00:00.000Z' }),
      ],
      nextCursor: 'gsi-cursor-1',
    });
    timeline.findClientActivity.mockResolvedValue([
      { id: 'c-new', timestamp: '2026-09-20T00:00:00.000Z', eventType: 'workiz_activity', actorId: 'w', actorName: 'W', details: {} },
      { id: 'c-old', timestamp: '2020-01-01T00:00:00.000Z', eventType: 'workiz_activity', actorId: 'w', actorName: 'W', details: {} },
    ]);

    const first = await service.list('c1', 2);
    expect(first.items.map((e) => e.id)).toEqual(['c-new', 'e1', 'e2']);
    expect(first.nextCursor).toBeDefined();
    expect(decode(first.nextCursor!)).toEqual({ t: 'gsi-cursor-1', b: '2026-09-05T00:00:00.000Z#e2' });

    timeline.findByContact.mockResolvedValue({ items: [], nextCursor: undefined });
    const last = await service.list('c1', 2, first.nextCursor);
    expect(timeline.findByContact).toHaveBeenLastCalledWith('c1', 2, 'gsi-cursor-1');
    // c-new was shown on page one; c-old is older than everything, so it closes the list.
    expect(last.items.map((e) => e.id)).toEqual(['c-old']);
    expect(last.nextCursor).toBeUndefined();
  });

  it('a cursor that is not ours is a 400, not a crash', async () => {
    await expect(service.list('c1', 30, 'not-base64-json')).rejects.toMatchObject({ status: 400 });
  });
});
