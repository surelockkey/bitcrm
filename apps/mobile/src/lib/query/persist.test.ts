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
    // "Have I got one on board?" is asked in basements.
    expect(shouldPersistQuery(q(queryKeys.inventory.containers.mine()))).toBe(true);
    expect(shouldPersistQuery(q(queryKeys.inventory.containers.stock('c1')))).toBe(true);
  });

  it('drops things that would be stale or useless on restore', () => {
    // A presigned URL is expired long before the app reopens.
    expect(shouldPersistQuery(q(queryKeys.deals.attachments('d1')))).toBe(false);
    expect(shouldPersistQuery(q(queryKeys.deals.timeline('d1')))).toBe(false);
    expect(shouldPersistQuery(q(queryKeys.contacts.detail('c1')))).toBe(false);
    // A restored unread count, with nothing behind it, is a badge that lies.
    expect(shouldPersistQuery(q(queryKeys.messaging.teamCounters()))).toBe(false);
    expect(shouldPersistQuery(q(['anything', 'else']))).toBe(false);
  });

  it('never writes a failed or still-loading query to disk', () => {
    expect(shouldPersistQuery(q(queryKeys.me(), 'error'))).toBe(false);
    expect(shouldPersistQuery(q(queryKeys.deals.list(), 'pending'))).toBe(false);
  });
});
