import { renderHook, waitFor } from '@testing-library/react-native';
import { queryKeys } from '../../lib/api/query-keys';
import { createTestQueryClient, withQuery } from '../../test/query';
import { findDealById, useMarkSeenOnOpen, useMyJobs } from './hooks';
import * as api from './api';
import { JobSuperStatus, type Deal } from './types';
import type { AuthState } from '../auth/auth-reducer';

jest.mock('./api');

let mockAuthState: AuthState = {
  status: 'signedIn',
  user: { id: 't1', email: 'tech@slk-s.com' },
};

jest.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    state: mockAuthState,
    submitting: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  }),
}));

const mockApi = api as jest.Mocked<typeof api>;

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: 'A1',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  ...over,
});

describe('findDealById', () => {
  it('finds a job in whichever cached list holds it', () => {
    const wanted = deal({ id: 'd2' });
    expect(findDealById([[deal()], [wanted]], 'd2')).toBe(wanted);
  });

  it('copes with a list that is still empty or undefined', () => {
    expect(findDealById([undefined, []], 'd2')).toBeUndefined();
  });
});

describe('useMyJobs', () => {
  beforeEach(() => {
    mockAuthState = { status: 'signedIn', user: { id: 't1', email: 'tech@slk-s.com' } };
    mockApi.fetchAllDeals.mockReset();
  });

  it("sends the technician's own id — without it the server returns the whole board", async () => {
    mockApi.fetchAllDeals.mockResolvedValue([]);
    await renderHook(() => useMyJobs('2026-09-16'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(mockApi.fetchAllDeals).toHaveBeenCalled());
    expect(mockApi.fetchAllDeals).toHaveBeenCalledWith({ techId: 't1' });
  });

  it('does not ask for anything until it knows who the technician is', async () => {
    mockAuthState = { status: 'signedOut' };
    mockApi.fetchAllDeals.mockResolvedValue([]);
    const { result } = await renderHook(() => useMyJobs('2026-09-16'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    expect(result.current.ready).toBe(false);
    // "Loading", not "no jobs today" — the difference matters on a phone.
    expect(result.current.isLoading).toBe(true);
    expect(mockApi.fetchAllDeals).not.toHaveBeenCalled();
  });

  it('groups what comes back into the day list, in visit order', async () => {
    mockApi.fetchAllDeals.mockResolvedValue([
      deal({ id: 'late', dealNumber: 'B', scheduledDate: '2026-09-16', scheduledTimeSlot: '14:00-16:00' }),
      deal({ id: 'early', dealNumber: 'A', scheduledDate: '2026-09-16', scheduledTimeSlot: '08:00-10:00' }),
      deal({ id: 'overdue', dealNumber: 'C', scheduledDate: '2026-09-10' }),
    ]);

    const { result } = await renderHook(() => useMyJobs('2026-09-16'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.groups.length).toBeGreaterThan(1));
    expect(result.current.groups.map((g) => g.key)).toEqual(['overdue', 'today']);
    expect(result.current.groups[1]!.deals.map((d) => d.id)).toEqual(['early', 'late']);
  });

  it('surfaces the failure rather than showing an empty day', async () => {
    mockApi.fetchAllDeals.mockRejectedValue(new Error('gateway down'));
    const { result } = await renderHook(() => useMyJobs('2026-09-16'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.deals).toEqual([]);
  });
});

/*
 * The other half of the Sent/Seen pair. "Seen" reads `seenByTechAt`, and only
 * this call writes it — so without these the stamp is a step that can never
 * complete: a card reading "Seen —" for the job the technician has open, and
 * an empty Seen column on the dispatcher's board for everyone who works off
 * the phone.
 */
describe('useMarkSeenOnOpen', () => {
  const mine = deal({ assignedTechIds: ['t1'] });

  beforeEach(() => {
    mockApi.markDealSeen.mockReset();
    mockApi.markDealSeen.mockResolvedValue({
      seen: true,
      seenAt: '2026-09-17T08:05:00.000Z',
      first: true,
    });
  });

  it('reports the open, once, for the technician the job belongs to', async () => {
    const { rerender } = await renderHook(() => useMarkSeenOnOpen(mine, 't1'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(mockApi.markDealSeen).toHaveBeenCalledWith('d1'));
    await rerender(undefined);
    expect(mockApi.markDealSeen).toHaveBeenCalledTimes(1);
  });

  it('fills the stamp on the job and on its card in the day list', async () => {
    const qc = createTestQueryClient();
    qc.setQueryData(queryKeys.deals.detail('d1'), mine);
    qc.setQueryData(queryKeys.deals.list({ techId: 't1' }), [mine, deal({ id: 'd2' })]);

    await renderHook(() => useMarkSeenOnOpen(mine, 't1'), { wrapper: withQuery(qc) });

    await waitFor(() =>
      expect(qc.getQueryData<Deal>(queryKeys.deals.detail('d1'))?.seenByTechAt).toBe(
        '2026-09-17T08:05:00.000Z',
      ),
    );
    // Going back one screen must not show the job as if nobody had looked.
    const list = qc.getQueryData<Deal[]>(queryKeys.deals.list({ techId: 't1' }));
    expect(list?.[0]?.seenByTechAt).toBe('2026-09-17T08:05:00.000Z');
    expect(list?.[1]?.seenByTechAt).toBeUndefined();
  });

  it('spends no request on a dispatcher looking at someone else’s job', async () => {
    // The server answers `seen: false` and writes nothing for anyone off the
    // roster, so the point is not making the call at all.
    await renderHook(() => useMarkSeenOnOpen(mine, 'dispatcher-9'), {
      wrapper: withQuery(createTestQueryClient()),
    });
    expect(mockApi.markDealSeen).not.toHaveBeenCalled();
  });

  it('waits for the job before reporting an open of it', async () => {
    await renderHook(() => useMarkSeenOnOpen(undefined, 't1'), {
      wrapper: withQuery(createTestQueryClient()),
    });
    expect(mockApi.markDealSeen).not.toHaveBeenCalled();
  });

  it('changes nothing on a later open the server has already stamped', async () => {
    mockApi.markDealSeen.mockResolvedValue({
      seen: true,
      seenAt: '2026-09-17T07:00:00.000Z',
      first: false,
    });
    const qc = createTestQueryClient();
    qc.setQueryData(queryKeys.deals.detail('d1'), mine);

    await renderHook(() => useMarkSeenOnOpen(mine, 't1'), { wrapper: withQuery(qc) });

    await waitFor(() => expect(mockApi.markDealSeen).toHaveBeenCalled());
    expect(qc.getQueryData<Deal>(queryKeys.deals.detail('d1'))?.seenByTechAt).toBeUndefined();
  });

  it('says nothing to a technician when the receipt cannot be delivered', async () => {
    // Opening a job in a basement is not an error worth a screen.
    mockApi.markDealSeen.mockRejectedValue(new Error('no signal'));
    const { result } = await renderHook(() => useMarkSeenOnOpen(mine, 't1'), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(mockApi.markDealSeen).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});
