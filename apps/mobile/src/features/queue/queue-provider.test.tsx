import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '../../lib/api/errors';
import { queryKeys } from '../../lib/api/query-keys';
import { createSqliteOutboxStore } from '../../lib/queue/db';
import type { AuthState } from '../auth/auth-reducer';
import { JobSuperStatus, type Deal } from '../jobs/types';
import type { FeedPages } from '../messaging/lib';
import { QueueProvider, useQueue } from './queue-provider';

/**
 * The provider's wiring — the part no pure test reaches.
 *
 * `drainOutbox` is covered exhaustively against a memory store, and the SQL
 * against a real engine (db.test.ts). What is left, and what went wrong, lives
 * between them: *when* a drain is allowed to run, *whose* rows it may touch,
 * and what it does to the react-query cache afterwards.
 */

const mockPerformOutboxAction = jest.fn();
const mockPresignUpload = jest.fn();
const mockPutUpload = jest.fn();
const mockSweepOrphanedPhotos = jest.fn().mockResolvedValue(0);

jest.mock('./transport', () => ({
  performOutboxAction: (...args: unknown[]) => mockPerformOutboxAction(...args),
  presignUpload: (...args: unknown[]) => mockPresignUpload(...args),
  putUpload: (...args: unknown[]) => mockPutUpload(...args),
  discardAttachment: jest.fn().mockResolvedValue(undefined),
  deleteLocalPhoto: jest.fn().mockResolvedValue(undefined),
  sweepOrphanedPhotos: () => mockSweepOrphanedPhotos(),
}));

let mockAuth: AuthState = { status: 'loading' };
jest.mock('../auth/auth-context', () => ({
  useAuth: () => ({ state: mockAuth }),
}));

const signedIn = (id: string): AuthState => ({
  status: 'signedIn',
  user: { id, email: `${id}@slk-s.com` },
});

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: 'K4T9ZW',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  createdAt: '2026-09-15T12:00:00.000Z',
  ...over,
});

/**
 * `gcTime: Infinity` rather than the default five minutes: react-query
 * schedules a real `setTimeout` per cached query to garbage-collect it, and
 * one of those left running is enough to stop Jest ever exiting.
 */
function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

async function mount(qc = testClient()) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <QueueProvider>{children}</QueueProvider>
    </QueryClientProvider>
  );
  return { qc, ...(await renderHook(() => useQueue(), { wrapper })) };
}

/** Put a row on disk behind the provider's back, as a previous session would. */
async function seedRow(userId: string, over: Record<string, unknown> = {}) {
  await createSqliteOutboxStore(userId).insert({
    id: `row-${userId}`,
    userId,
    kind: 'arrived',
    dealId: 'd1',
    payload: '{}',
    createdAt: 1_000,
    attempts: 0,
    nextAttemptAt: 1_000,
    lastError: null,
    state: 'pending',
    ...over,
  });
}

beforeEach(() => {
  mockAuth = { status: 'loading' };
  mockPerformOutboxAction.mockReset().mockResolvedValue(undefined);
  mockPresignUpload.mockReset();
  mockPutUpload.mockReset();
  mockSweepOrphanedPhotos.mockClear();
});

describe('the session gate', () => {
  it('sends nothing while the session is still being restored', async () => {
    // QueueProvider is a child of AuthProvider, so its effects run FIRST — a
    // drain here would race `loadTokens()` and go out with no Authorization
    // header, and the 401 that came back used to park every row for good.
    await seedRow('tech-a');
    mockAuth = { status: 'loading' };

    const { result } = await mount();
    await act(async () => {
      await result.current.drainNow();
    });

    expect(mockPerformOutboxAction).not.toHaveBeenCalled();
  });

  it('sends nothing at all once the technician has signed out', async () => {
    await seedRow('tech-a');
    mockAuth = { status: 'signedOut' };

    const { result } = await mount();
    await act(async () => {
      await result.current.drainNow();
    });

    expect(mockPerformOutboxAction).not.toHaveBeenCalled();
    expect(result.current.records).toEqual([]);
  });

  it('drains the moment there is a session behind it', async () => {
    await seedRow('tech-a');
    mockAuth = signedIn('tech-a');

    await mount();

    await waitFor(() => expect(mockPerformOutboxAction).toHaveBeenCalledTimes(1));
    expect(mockPerformOutboxAction.mock.calls[0]![0]).toMatchObject({
      id: 'row-tech-a',
      userId: 'tech-a',
    });
  });

  it('refuses to queue anything without a signed-in technician', async () => {
    mockAuth = { status: 'signedOut' };
    const { result } = await mount();

    await expect(
      result.current.enqueueAction({ kind: 'note', dealId: 'd1', payload: { note: 'x' } }),
    ).rejects.toThrow(/signed-in technician/);
  });
});

describe('a van’s phone handed to the next technician', () => {
  it('shows the new technician nothing the last one queued', async () => {
    await seedRow('tech-a');
    mockAuth = signedIn('tech-b');

    const { result } = await mount();
    await waitFor(() => expect(mockSweepOrphanedPhotos).toHaveBeenCalled());

    expect(result.current.records).toEqual([]);
    expect(result.current.waiting).toBe(0);
  });

  it('never re-sends the last technician’s arrival under the new one', async () => {
    await seedRow('tech-a');
    mockAuth = signedIn('tech-b');

    const { result } = await mount();
    await act(async () => {
      await result.current.drainNow();
    });

    expect(mockPerformOutboxAction).not.toHaveBeenCalled();
  });

  it('gives the first technician their own rows back when they sign in again', async () => {
    await seedRow('tech-a');
    mockAuth = signedIn('tech-a');

    const { result } = await mount();

    await waitFor(() => expect(result.current.records).toHaveLength(1));
    expect(result.current.records[0]!.userId).toBe('tech-a');
  });

  it('stamps every row it queues with whoever is holding the phone', async () => {
    mockAuth = signedIn('tech-b');
    const { result } = await mount();

    await act(async () => {
      await result.current.enqueueAction({ kind: 'note', dealId: 'd1', payload: {} });
    });

    await waitFor(() => expect(result.current.records).toHaveLength(1));
    expect(result.current.records[0]!.userId).toBe('tech-b');
  });
});

describe('what a settled row does to the cache', () => {
  it('writes the server’s own copy of the job in, without re-downloading anything', async () => {
    // `GET /deals` has no date filter, so invalidating the list walks every
    // page of the technician's whole history — up to fifty requests — for one
    // tap on "Arrived".
    await seedRow('tech-a');
    mockAuth = signedIn('tech-a');
    const arrived = deal({ arrivedAt: '2026-09-16T10:00:00.000Z' });
    mockPerformOutboxAction.mockResolvedValue(arrived);

    const qc = testClient();
    qc.setQueryData(queryKeys.deals.list({ techId: 'tech-a' }), [deal()]);
    const invalidate = jest.spyOn(qc, 'invalidateQueries');

    await mount(qc);
    await waitFor(() => expect(mockPerformOutboxAction).toHaveBeenCalled());

    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.deals.detail('d1'))).toEqual(arrived),
    );
    expect(
      qc.getQueryData<Deal[]>(queryKeys.deals.list({ techId: 'tech-a' })),
    ).toEqual([arrived]);

    const listInvalidations = invalidate.mock.calls.filter(
      ([arg]) =>
        JSON.stringify(arg?.queryKey) === JSON.stringify(queryKeys.deals.lists()),
    );
    expect(listInvalidations).toHaveLength(0);
  });

  it('falls back to refetching the one job when the action answers with nothing', async () => {
    await seedRow('tech-a', { kind: 'note', payload: '{"note":"gate code"}' });
    mockAuth = signedIn('tech-a');
    mockPerformOutboxAction.mockResolvedValue(undefined);

    const qc = testClient();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');

    await mount(qc);
    await waitFor(() => expect(mockPerformOutboxAction).toHaveBeenCalled());

    await waitFor(() => {
      const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.deals.detail('d1')));
    });
    const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
    expect(keys).not.toContain(JSON.stringify(queryKeys.deals.lists()));
  });

  it('refreshes the thread, and no job at all, when a line reaches the office', async () => {
    await seedRow('tech-a', {
      kind: 'chat',
      dealId: '',
      payload: '{"conversationId":"conv-1","body":"door is locked"}',
    });
    mockAuth = signedIn('tech-a');
    mockPerformOutboxAction.mockResolvedValue(undefined);

    const qc = testClient();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');

    await mount(qc);
    await waitFor(() => expect(mockPerformOutboxAction).toHaveBeenCalled());

    await waitFor(() => {
      const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.messaging.all()));
    });
    // A message is about no job: `deals.detail('')` is a query nobody holds.
    const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
    expect(keys).not.toContain(JSON.stringify(queryKeys.deals.detail('')));
  });

  it('puts the office’s own copy of the line in the thread, not a refetch away', async () => {
    // The pending bubble goes the instant the row is `done`. If nothing takes
    // its place in the same render, the technician watches their message
    // vanish for as long as the refetch takes — and for good if the signal
    // drops in between, which is when they type it again.
    await seedRow('tech-a', {
      kind: 'chat',
      dealId: '',
      payload: '{"conversationId":"conv-1","body":"door is locked"}',
    });
    mockAuth = signedIn('tech-a');
    const stored = {
      id: 'm-9',
      conversationId: 'conv-1',
      body: 'door is locked',
      createdAt: '2026-09-16T13:00:00.000Z',
    };
    mockPerformOutboxAction.mockResolvedValue(stored);

    const qc = testClient();
    await mount(qc);

    await waitFor(() =>
      expect(
        qc.getQueryData<FeedPages>(queryKeys.messaging.messages('conv-1'))?.pages[0]?.data,
      ).toEqual([stored]),
    );
  });

  it('keeps draining a lane it had to leave half-emptied', async () => {
    // Two lines typed seconds apart share one ordering lane, so one pass can
    // only take the first. Left at that, the second said "Waiting for a
    // signal" until the next tick — thirty seconds, on a phone with five bars.
    await seedRow('tech-a', {
      id: 'line-1',
      kind: 'chat',
      dealId: '',
      createdAt: 1_000,
      payload: '{"conversationId":"conv-1","body":"first"}',
    });
    await seedRow('tech-a', {
      id: 'line-2',
      kind: 'chat',
      dealId: '',
      createdAt: 2_000,
      payload: '{"conversationId":"conv-1","body":"second"}',
    });
    mockAuth = signedIn('tech-a');
    mockPerformOutboxAction.mockResolvedValue({ id: 'm', conversationId: 'conv-1' });

    await mount();

    await waitFor(() => expect(mockPerformOutboxAction).toHaveBeenCalledTimes(2));
    expect(
      mockPerformOutboxAction.mock.calls.map(([r]) => (r as { id: string }).id),
    ).toEqual(['line-1', 'line-2']);
  });

  it('never mistakes a time entry for the job it was started on', async () => {
    /*
     * A `TimeClockEntry` has an `id`, which is all `asDeal` looks for. Without
     * a check for the clock's own kinds first, clocking in from a job would
     * write the time entry into the cache *as* that job, and the technician
     * would come back to a job screen rendering a clock entry.
     */
    await seedRow('tech-a', { kind: 'timeclock_in', dealId: 'd1' });
    mockAuth = signedIn('tech-a');
    mockPerformOutboxAction.mockResolvedValue({
      id: 'entry-1',
      userId: 'tech-a',
      startedAt: '2026-09-17T09:00:00.000Z',
      source: 'mobile',
      createdAt: '2026-09-17T09:00:00.000Z',
      updatedAt: '2026-09-17T09:00:00.000Z',
    });

    const qc = testClient();
    qc.setQueryData(queryKeys.deals.detail('d1'), deal());
    const invalidate = jest.spyOn(qc, 'invalidateQueries');

    await mount(qc);
    await waitFor(() => expect(mockPerformOutboxAction).toHaveBeenCalled());

    expect(qc.getQueryData(queryKeys.deals.detail('d1'))).toEqual(deal());
    // What it does refresh is the clock: the running entry and every range on
    // screen, so the server's own stamp replaces the phone's guess.
    await waitFor(() => {
      const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.timeclock.all()));
    });
  });

  it('leaves no gap between the queued clock and the server’s own entry', async () => {
    /*
     * The optimistic clock runs off the queue row, and the row is `done` the
     * instant the request returns. Left to a refetch there is a round trip in
     * which the row no longer counts and the answer has not arrived — the card
     * reads "Not on the clock" and offers "Clock in" to somebody who has just
     * clocked in. A second tap there is a second entry.
     */
    await seedRow('tech-a', { kind: 'timeclock_in', dealId: '' });
    mockAuth = signedIn('tech-a');
    const started = {
      id: 'entry-1',
      userId: 'tech-a',
      startedAt: '2026-09-17T09:00:00.000Z',
      source: 'mobile',
      createdAt: '2026-09-17T09:00:00.000Z',
      updatedAt: '2026-09-17T09:00:00.000Z',
    };
    mockPerformOutboxAction.mockResolvedValue(started);

    const qc = testClient();
    await mount(qc);

    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.timeclock.current())).toEqual(started),
    );
  });

  it('empties the running entry when the clock-out lands', async () => {
    await seedRow('tech-a', { kind: 'timeclock_out', dealId: '' });
    mockAuth = signedIn('tech-a');
    mockPerformOutboxAction.mockResolvedValue({
      id: 'entry-1',
      userId: 'tech-a',
      startedAt: '2026-09-17T09:00:00.000Z',
      // A finished entry is not the running one, whichever call returned it.
      endedAt: '2026-09-17T17:00:00.000Z',
      minutes: 480,
      source: 'mobile',
      createdAt: '2026-09-17T09:00:00.000Z',
      updatedAt: '2026-09-17T17:00:00.000Z',
    });

    const qc = testClient();
    qc.setQueryData(queryKeys.timeclock.current(), {
      id: 'entry-1',
      startedAt: '2026-09-17T09:00:00.000Z',
    });
    await mount(qc);

    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.timeclock.current())).toBeNull(),
    );
  });

  it('re-reads the clock even when the clock row failed', async () => {
    // The screen has to stop showing a clock that is not running.
    await seedRow('tech-a', { kind: 'timeclock_out', dealId: '' });
    mockAuth = signedIn('tech-a');
    mockPerformOutboxAction.mockRejectedValue(new ApiError(400, 'No clock running'));

    const qc = testClient();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');

    await mount(qc);
    await waitFor(() => expect(mockPerformOutboxAction).toHaveBeenCalled());

    await waitFor(() => {
      const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.timeclock.all()));
    });
  });
});

describe('patching a queued payload', () => {
  it('folds a late GPS fix into an arrival that has not left yet', async () => {
    mockAuth = signedIn('tech-a');
    // The case this exists for: a doorstep with no signal, where the fix takes
    // the full eight seconds and the row is still waiting when it lands.
    mockPerformOutboxAction.mockRejectedValue(new ApiError(0, 'no signal'));
    const { result } = await mount();

    let id = '';
    await act(async () => {
      // Queued with no fix, which is the whole point: the row is on disk
      // before the eight-second GPS wait starts.
      id = await result.current.enqueueAction({
        kind: 'arrived',
        dealId: 'd1',
        payload: {},
      });
    });
    await act(async () => {
      await result.current.patchActionPayload(id, { lat: 41.76, lng: -72.68 });
    });

    const row = result.current.records.find((r) => r.id === id);
    expect(row?.queue === 'outbox' && JSON.parse(row.payload)).toEqual({
      lat: 41.76,
      lng: -72.68,
    });
  });

  it('leaves a row alone once it is no longer pending', async () => {
    await seedRow('tech-a', { state: 'failed', lastError: 'Job is already closed' });
    mockAuth = signedIn('tech-a');

    const { result } = await mount();
    await waitFor(() => expect(result.current.records).toHaveLength(1));

    await act(async () => {
      await result.current.patchActionPayload('row-tech-a', { lat: 1, lng: 2 });
    });

    const row = result.current.records[0]!;
    expect(row.queue === 'outbox' && row.payload).toBe('{}');
  });
});
