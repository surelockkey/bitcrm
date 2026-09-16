import { renderHook, waitFor } from '@testing-library/react-native';
import { createTestQueryClient, withQuery } from '../../test/query';
import { findDealById, useMyJobs } from './hooks';
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
