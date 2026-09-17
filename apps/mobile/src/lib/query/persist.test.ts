import { shouldPersistQuery } from './persist';
import { queryKeys } from '../api/query-keys';

const q = (queryKey: readonly unknown[], status = 'success') => ({
  queryKey,
  state: { status },
});

describe('shouldPersistQuery', () => {
  it('keeps what a technician needs with no signal at all', () => {
    expect(shouldPersistQuery(q(queryKeys.me()))).toBe(true);
    expect(shouldPersistQuery(q(queryKeys.deals.list({ techId: 'u1' })))).toBe(true);
    expect(shouldPersistQuery(q(queryKeys.deals.detail('d1')))).toBe(true);
    // What the office said is unreadable underground unless it is on the phone.
    expect(shouldPersistQuery(q(queryKeys.messaging.teamThread()))).toBe(true);
    expect(shouldPersistQuery(q(queryKeys.messaging.messages('conv-1')))).toBe(true);
    // And so is the list of who has written: a Messages screen opened in a
    // basement that shows only the office thread has silently lost every
    // client conversation the technician had this morning.
    expect(shouldPersistQuery(q(queryKeys.messaging.conversations()))).toBe(true);
    // "Have I got one on board?" is asked in basements.
    expect(shouldPersistQuery(q(queryKeys.inventory.containers.mine()))).toBe(true);
    expect(shouldPersistQuery(q(queryKeys.inventory.containers.stock('c1')))).toBe(true);
    // The running clock. A phone that forgets it over a restart in a basement
    // offers "Clock in" to somebody who clocked in at seven, and that tap is a
    // second entry on the same shift.
    expect(shouldPersistQuery(q(queryKeys.timeclock.current()))).toBe(true);
  });

  it('drops things that would be stale or useless on restore', () => {
    // A presigned URL is expired long before the app reopens.
    expect(shouldPersistQuery(q(queryKeys.deals.attachments('d1')))).toBe(false);
    expect(shouldPersistQuery(q(queryKeys.deals.timeline('d1')))).toBe(false);
    expect(shouldPersistQuery(q(queryKeys.contacts.detail('c1')))).toBe(false);
    // A restored unread count, with nothing behind it, is a badge that lies.
    expect(shouldPersistQuery(q(queryKeys.messaging.teamCounters()))).toBe(false);
    // A week of hours restored from disk would read as this week's timesheet
    // while being last week's; the running entry is the only clock row worth
    // keeping, and the week is re-read or plainly marked as stale.
    expect(
      shouldPersistQuery(q(queryKeys.timeclock.range('2026-09-14', '2026-09-21'))),
    ).toBe(false);
    expect(shouldPersistQuery(q(['anything', 'else']))).toBe(false);
  });

  it('never writes a failed or still-loading query to disk', () => {
    expect(shouldPersistQuery(q(queryKeys.me(), 'error'))).toBe(false);
    expect(shouldPersistQuery(q(queryKeys.deals.list(), 'pending'))).toBe(false);
  });
});
