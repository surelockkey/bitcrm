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

/** `GET /deals/:id` — the one read the provider makes on its own account. */
const mockGetDeal = jest.fn();
jest.mock('../jobs/api', () => ({
  getDeal: (...args: unknown[]) => mockGetDeal(...args),
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
  mockGetDeal.mockReset().mockResolvedValue(deal());
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
});

/**
 * A visit the phone moved and the server never did.
 *
 * Every queued action patches the job at the tap, and for most of them a
 * failure leaves a wrong chip on a card. A reschedule leaves the job on
 * another *day* — off the list the technician is working from, onto one they
 * are not — and the day list is the one query the drain deliberately never
 * invalidates, so nothing else takes the guess back off it.
 */
describe('a move the server refused', () => {
  const RESCHEDULE = {
    kind: 'reschedule',
    payload: '{"scheduledDate":"2026-09-18","scheduledTimeSlot":"14:00-16:00","allDay":false}',
  };
  const booked = deal({ scheduledDate: '2026-09-16', scheduledTimeSlot: '09:00-12:00' });
  const guessed = deal({ scheduledDate: '2026-09-18', scheduledTimeSlot: '14:00-16:00' });

  it('puts the visit back on the day the office has it', async () => {
    await seedRow('tech-a', RESCHEDULE);
    mockAuth = signedIn('tech-a');
    // 400 is permanent: the row is parked, not retried.
    mockPerformOutboxAction.mockRejectedValue(new ApiError(400, 'Job is already closed'));
    mockGetDeal.mockResolvedValue(booked);

    const qc = testClient();
    qc.setQueryData(queryKeys.deals.list({ techId: 'tech-a' }), [guessed]);
    qc.setQueryData(queryKeys.deals.detail('d1'), guessed);

    await mount(qc);

    await waitFor(() =>
      expect(qc.getQueryData<Deal[]>(queryKeys.deals.list({ techId: 'tech-a' }))).toEqual([
        booked,
      ]),
    );
    expect(qc.getQueryData(queryKeys.deals.detail('d1'))).toEqual(booked);
    expect(mockGetDeal).toHaveBeenCalledWith('d1');
  });

  it('leaves the job marked stale when it cannot read it back', async () => {
    await seedRow('tech-a', RESCHEDULE);
    mockAuth = signedIn('tech-a');
    mockPerformOutboxAction.mockRejectedValue(new ApiError(403, 'not your job'));
    // The phone went back underground between the refusal and the re-read.
    mockGetDeal.mockRejectedValue(new ApiError(0, 'no signal'));

    const qc = testClient();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');
    await mount(qc);

    await waitFor(() => {
      const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.deals.detail('d1')));
    });
  });

  it('reads nothing back for a row that failed without moving anything', async () => {
    await seedRow('tech-a', { kind: 'note', payload: '{"note":"gate code"}' });
    mockAuth = signedIn('tech-a');
    mockPerformOutboxAction.mockRejectedValue(new ApiError(400, 'no'));

    const qc = testClient();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');
    await mount(qc);

    await waitFor(() => {
      const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.deals.detail('d1')));
    });
    expect(mockGetDeal).not.toHaveBeenCalled();
  });

  it('puts the visit back when the technician throws the move away themselves', async () => {
    await seedRow('tech-a', { ...RESCHEDULE, state: 'failed', lastError: 'Job is already closed' });
    mockAuth = signedIn('tech-a');
    mockGetDeal.mockResolvedValue(booked);

    const qc = testClient();
    qc.setQueryData(queryKeys.deals.list({ techId: 'tech-a' }), [guessed]);

    const { result } = await mount(qc);
    await waitFor(() => expect(result.current.records).toHaveLength(1));

    await act(async () => {
      await result.current.discard('outbox', 'row-tech-a');
    });

    expect(
      qc.getQueryData<Deal[]>(queryKeys.deals.list({ techId: 'tech-a' })),
    ).toEqual([booked]);
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
