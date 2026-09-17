import { renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '../../lib/api/errors';
import { createTestQueryClient, withQuery } from '../../test/query';
import * as api from './api';
import { useMyContainer, useMyStock } from './hooks';
import type { StockItem } from './types';

jest.mock('./api');

const mockApi = api as jest.Mocked<typeof api>;

const container = { id: 'c1', name: 'Van 7', department: 'Locksmith' };

const item = (over: Partial<StockItem> = {}): StockItem => ({
  productId: 'p1',
  productName: 'Kwikset deadbolt',
  quantity: 4,
  updatedAt: '2026-09-17T08:00:00.000Z',
  ...over,
});

beforeEach(() => {
  mockApi.getMyContainer.mockReset();
  mockApi.getContainerStock.mockReset();
});

describe('useMyContainer', () => {
  it('treats a 404 as "no van yet", not as a failure', async () => {
    mockApi.getMyContainer.mockRejectedValue(new ApiError(404, 'Not found'));

    const { result } = await renderHook(() => useMyContainer(), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.unassigned).toBe(true));
    // A red "something went wrong" would send a technician looking for a
    // problem only the office can fix.
    expect(result.current.error).toBeUndefined();
  });

  it('still reports a real failure as one', async () => {
    mockApi.getMyContainer.mockRejectedValue(new ApiError(500, 'Boom'));

    const { result } = await renderHook(() => useMyContainer(), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.unassigned).toBe(false);
  });
});

describe('useMyStock', () => {
  it('asks the container for its own id, then asks that container for stock', async () => {
    mockApi.getMyContainer.mockResolvedValue(container);
    mockApi.getContainerStock.mockResolvedValue([item()]);

    const { result } = await renderHook(() => useMyStock(), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(mockApi.getContainerStock).toHaveBeenCalledWith('c1');
    expect(result.current.summary).toEqual({ skuCount: 1, totalUnits: 4 });
  });

  it('never asks for stock before it knows which van', async () => {
    mockApi.getMyContainer.mockRejectedValue(new ApiError(404, 'Not found'));

    const { result } = await renderHook(() => useMyStock(), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.unassigned).toBe(true));
    expect(mockApi.getContainerStock).not.toHaveBeenCalled();
  });

  it('is loading — not empty — while the van is still being identified', async () => {
    let release: (c: typeof container) => void = () => {};
    mockApi.getMyContainer.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mockApi.getContainerStock.mockResolvedValue([]);

    const { result } = await renderHook(() => useMyStock(), {
      wrapper: withQuery(createTestQueryClient()),
    });

    // "Empty van" here would be a lie a technician would act on.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.rows).toEqual([]);

    release(container);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('does not ask for the stock of a van that does not exist', async () => {
    /*
     * `enabled` gates automatic fetching only — react-query runs `queryFn` on
     * an explicit `refetch()` regardless. So "Try again" / "Check again" on a
     * technician with no container used to send
     * `GET /inventory/containers/undefined/stock`.
     */
    mockApi.getMyContainer.mockRejectedValue(new ApiError(404, 'Not found'));

    const { result } = await renderHook(() => useMyStock(), {
      wrapper: withQuery(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.unassigned).toBe(true));

    result.current.refetch();
    await waitFor(() => expect(mockApi.getMyContainer).toHaveBeenCalledTimes(2));
    expect(mockApi.getContainerStock).not.toHaveBeenCalled();
  });

  it('admits the rows are the phone’s own copy when the van itself would not load', async () => {
    // Whichever of the two requests failed, the quantities on screen are
    // equally old, and the banner is the only thing that says so.
    mockApi.getMyContainer.mockResolvedValueOnce(container);
    mockApi.getContainerStock.mockResolvedValue([item()]);

    const { result } = await renderHook(() => useMyStock(), {
      wrapper: withQuery(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.stale).toBe(false);

    mockApi.getMyContainer.mockRejectedValue(new ApiError(0, 'Unable to reach the server.'));
    result.current.refetch();

    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.rows).toHaveLength(1);
  });

  it('sorts and drops zero rows on the way through', async () => {
    mockApi.getMyContainer.mockResolvedValue(container);
    mockApi.getContainerStock.mockResolvedValue([
      item({ productId: 'p2', productName: 'Zinc plate', quantity: 1 }),
      item({ productId: 'p3', productName: 'Brass blank', quantity: 0 }),
      item({ productId: 'p1', productName: 'Kwikset deadbolt', quantity: 4 }),
    ]);

    const { result } = await renderHook(() => useMyStock(), {
      wrapper: withQuery(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map((r) => r.name)).toEqual([
      'Kwikset deadbolt',
      'Zinc plate',
    ]);
  });
});
