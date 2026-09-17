import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { queryKeys } from '../../lib/api/query-keys';
import { localDateIso, shiftDateIso } from './lib';
import { RescheduleRefused } from './reschedule';
import { useJobActions } from './use-job-actions';
import { JobSuperStatus, type Deal } from './types';

/**
 * The order in which "Arrived" does things, which is the whole finding.
 */

const mockEnqueueAction = jest.fn();
const mockPatchActionPayload = jest.fn();
const mockCurrentPosition = jest.fn();

jest.mock('../queue/queue-provider', () => ({
  useQueue: () => ({
    enqueueAction: mockEnqueueAction,
    patchActionPayload: mockPatchActionPayload,
  }),
}));
jest.mock('./hooks', () => ({ useMe: () => ({ data: { id: 'tech-a' } }) }));
jest.mock('./location', () => ({
  currentPosition: () => mockCurrentPosition(),
}));

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: 'K4T9ZW',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  createdAt: '2026-09-15T12:00:00.000Z',
  ...over,
});

async function mount() {
  // `gcTime: Infinity` so react-query schedules no garbage-collection timer;
  // one of those left running keeps Jest from ever exiting.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  qc.setQueryData(queryKeys.deals.detail('d1'), deal());
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...(await renderHook(() => useJobActions('d1'), { wrapper })) };
}

beforeEach(() => {
  mockEnqueueAction.mockReset().mockResolvedValue('row-1');
  mockPatchActionPayload.mockReset().mockResolvedValue(undefined);
  mockCurrentPosition.mockReset().mockResolvedValue(undefined);
});

describe('arrive', () => {
  it('queues the arrival BEFORE it goes looking for a fix', async () => {
    // Eight seconds of no feedback on the app's hero action, at a doorstep on
    // one bar — and an app killed inside that window used to lose the arrival
    // entirely, because nothing had been written down yet.
    const order: string[] = [];
    mockEnqueueAction.mockImplementation(async () => {
      order.push('enqueue');
      return 'row-1';
    });
    mockCurrentPosition.mockImplementation(async () => {
      order.push('locate');
      return undefined;
    });

    const { result } = await mount();
    await act(async () => {
      await result.current.arrive();
    });

    expect(order).toEqual(['enqueue', 'locate']);
    expect(mockEnqueueAction).toHaveBeenCalledWith({
      kind: 'arrived',
      dealId: 'd1',
      payload: {},
    });
  });

  it('stamps the job the instant it is tapped, fix or no fix', async () => {
    const { result, qc } = await mount();
    await act(async () => {
      await result.current.arrive();
    });

    const cached = qc.getQueryData<Deal>(queryKeys.deals.detail('d1'));
    expect(cached?.arrivedAt).toBeTruthy();
    expect(cached?.arrivedBy).toBe('tech-a');
  });

  it('folds the coordinates into the queued row once they turn up', async () => {
    mockCurrentPosition.mockResolvedValue({ lat: 41.76, lng: -72.68, accuracy: 9 });

    const { result, qc } = await mount();
    await act(async () => {
      await result.current.arrive();
    });

    expect(mockPatchActionPayload).toHaveBeenCalledWith('row-1', {
      lat: 41.76,
      lng: -72.68,
      accuracy: 9,
    });
    expect(
      qc.getQueryData<Deal>(queryKeys.deals.detail('d1'))?.arrivedLocation,
    ).toEqual({ lat: 41.76, lng: -72.68, accuracy: 9 });
  });

  it('does not touch the row when no fix ever arrives', async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.arrive();
    });

    expect(mockPatchActionPayload).not.toHaveBeenCalled();
  });
});

describe('the rest of the actions', () => {
  it('queues each one with the payload the server expects', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.confirm();
      await result.current.start();
      await result.current.finish();
      await result.current.addNote('Gate code 4821');
      await result.current.onMyWay(20);
      await result.current.runningLate(15);
    });

    expect(mockEnqueueAction.mock.calls.map(([c]) => [c.kind, c.payload])).toEqual([
      ['confirm', {}],
      ['status', { superStatus: JobSuperStatus.IN_PROGRESS }],
      ['status', { superStatus: JobSuperStatus.DONE }],
      ['note', { note: 'Gate code 4821' }],
      ['on_my_way', { etaMinutes: 20 }],
      ['late', { minutes: 15 }],
    ]);
  });
});

describe('reschedule', () => {
  const tomorrow = shiftDateIso(localDateIso(), 1);
  const yesterday = shiftDateIso(localDateIso(), -1);

  it('queues the move and shows it on the job at once', async () => {
    const { result, qc } = await mount();

    await act(async () => {
      await result.current.reschedule({
        scheduledDate: tomorrow,
        scheduledTimeSlot: '14:00-16:00',
        allDay: false,
      });
    });

    expect(mockEnqueueAction).toHaveBeenCalledWith({
      kind: 'reschedule',
      dealId: 'd1',
      payload: {
        scheduledDate: tomorrow,
        scheduledTimeSlot: '14:00-16:00',
        allDay: false,
      },
    });
    const cached = qc.getQueryData<Deal>(queryKeys.deals.detail('d1'));
    expect(cached?.scheduledDate).toBe(tomorrow);
    expect(cached?.scheduledTimeSlot).toBe('14:00-16:00');
  });

  // The sheet can sit open in a pocket across midnight. The last word on
  // whether a move is allowed belongs here, not to whatever the sheet was
  // showing when it was opened.
  it('refuses a move into a day that has gone, and queues nothing', async () => {
    const { result, qc } = await mount();

    await act(async () => {
      await expect(
        result.current.reschedule({
          scheduledDate: yesterday,
          scheduledTimeSlot: '10:00-12:00',
        }),
      ).rejects.toBeInstanceOf(RescheduleRefused);
    });

    expect(mockEnqueueAction).not.toHaveBeenCalled();
    // And the job on screen is untouched — there is no optimistic patch to undo.
    expect(
      qc.getQueryData<Deal>(queryKeys.deals.detail('d1'))?.scheduledDate,
    ).toBeUndefined();
  });

  it('says why it refused, in words a technician can act on', async () => {
    const { result } = await mount();

    await act(async () => {
      await expect(
        result.current.reschedule({ scheduledDate: tomorrow }),
      ).rejects.toThrow(/Pick a time window/);
    });
  });
});
