import { fireEvent, screen } from '@testing-library/react-native';
import { ApiError } from '../../lib/api/errors';
import type { QueueRecord } from '../../lib/queue/types';
import { renderScreen } from '../../test/render';
import { TimesheetScreen } from './timesheet-screen';
import type { ClockState } from './lib';
import type { TimeClockEntry } from './types';

const mockClockIn = jest.fn().mockResolvedValue(undefined);
const mockClockOut = jest.fn().mockResolvedValue(undefined);

let mockState: ClockState = { status: 'off' };
let mockFailed: QueueRecord[] = [];
let mockTimesheet: {
  days: { dateIso: string; label: string; entries: TimeClockEntry[]; minutes: number }[];
  todayMinutes: number;
  weekMinutes: number;
  entries: TimeClockEntry[];
  isLoading: boolean;
  isRefetching: boolean;
  error: unknown;
  stale: boolean;
  refetch: () => void;
};

jest.mock('./hooks', () => ({
  useClockState: () => ({
    state: mockState,
    failed: mockFailed,
    isLoading: false,
    refetch: jest.fn(),
  }),
  useClockActions: () => ({ clockIn: mockClockIn, clockOut: mockClockOut }),
  useTimesheet: () => mockTimesheet,
  // The job number is read out of the query cache, which this screen has none
  // of; the lookup itself is covered where it lives.
  useDealNumber: (dealId: string | undefined) => (dealId ? '1042' : undefined),
}));

const local = (dateIso: string, clock: string): string =>
  new Date(`${dateIso}T${clock}`).toISOString();

const entry = (over: Partial<TimeClockEntry> = {}): TimeClockEntry => ({
  id: 'e1',
  userId: 'tech-1',
  startedAt: local('2026-09-17', '09:03:00'),
  endedAt: local('2026-09-17', '11:47:00'),
  minutes: 164,
  source: 'mobile',
  createdAt: local('2026-09-17', '09:03:00'),
  updatedAt: local('2026-09-17', '11:47:00'),
  ...over,
});

const timesheet = (over: Partial<typeof mockTimesheet> = {}): typeof mockTimesheet => ({
  days: [
    { dateIso: '2026-09-17', label: 'Today', entries: [entry()], minutes: 164 },
  ],
  todayMinutes: 164,
  weekMinutes: 465,
  entries: [entry()],
  isLoading: false,
  isRefetching: false,
  error: undefined,
  stale: false,
  refetch: jest.fn(),
  ...over,
});

const props = { onBack: jest.fn(), todayIso: '2026-09-17' };

beforeEach(() => {
  mockState = { status: 'off' };
  mockFailed = [];
  mockTimesheet = timesheet();
  mockClockIn.mockClear();
  mockClockOut.mockClear();
  props.onBack.mockClear();
});

describe('TimesheetScreen', () => {
  it.each(['light', 'dark'] as const)('renders in the %s theme', async (scheme) => {
    await renderScreen(<TimesheetScreen {...props} />, { scheme });
    expect(screen.getByTestId('timesheet-screen')).toBeTruthy();
    expect(screen.getByText('Timesheet')).toBeTruthy();
  });

  it('leads with the clock, which is why anybody opens this screen', async () => {
    await renderScreen(<TimesheetScreen {...props} />);
    expect(screen.getByTestId('clock-card')).toBeTruthy();
    expect(screen.getByTestId('clock-in')).toBeTruthy();
    expect(screen.queryByTestId('clock-out')).toBeNull();
  });

  it('clocks in for the day, carrying no job — Workiz’s Menu → Timesheets (§1.7)', async () => {
    await renderScreen(<TimesheetScreen {...props} />);
    await fireEvent.press(screen.getByTestId('clock-in'));
    expect(mockClockIn).toHaveBeenCalledWith(undefined);
  });

  it('shows a running stopwatch and offers only the way out', async () => {
    mockState = {
      status: 'on',
      entry: entry({
        startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        endedAt: undefined,
        minutes: undefined,
      }),
    };
    await renderScreen(<TimesheetScreen {...props} />);

    expect(screen.getByText('On the clock')).toBeTruthy();
    // `includeHiddenElements` because the stopwatch is deliberately hidden from
    // the screen reader — the card around it already announces "On the clock,
    // 2 hours" rather than reading digits one at a time.
    expect(
      screen.getByTestId('clock-elapsed', { includeHiddenElements: true }),
    ).toHaveTextContent(/^\d+:\d{2}:\d{2}$/);
    expect(screen.getByTestId('clock-out')).toBeTruthy();
    expect(screen.queryByTestId('clock-in')).toBeNull();
  });

  it('holds the one-minute rule on the button itself', async () => {
    mockState = {
      status: 'on',
      entry: entry({
        startedAt: new Date(Date.now() - 5_000).toISOString(),
        endedAt: undefined,
        minutes: undefined,
      }),
    };
    await renderScreen(<TimesheetScreen {...props} />);

    const out = screen.getByTestId('clock-out');
    expect(out).toBeDisabled();
    await fireEvent.press(out);
    expect(mockClockOut).not.toHaveBeenCalled();
  });

  it('counts the running clock in neither total, and says where it went', async () => {
    // A total that climbs while the technician watches it disagrees with every
    // number the office has.
    mockState = {
      status: 'on',
      entry: entry({
        startedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
        endedAt: undefined,
        minutes: undefined,
      }),
    };
    await renderScreen(<TimesheetScreen {...props} />);

    // Both totals are announced by their accessible wrapper, which is what a
    // screen reader reads and what these assertions therefore use.
    expect(screen.getByLabelText('Today, 2h 44m')).toBeTruthy();
    expect(screen.getByLabelText('This week, 7h 45m')).toBeTruthy();
    expect(screen.getByTestId('running-note')).toHaveTextContent(
      /Plus \d+:\d{2} running now/,
    );
  });

  it('shows each entry as when it ran, how long, and which job', async () => {
    mockTimesheet = timesheet({
      days: [
        {
          dateIso: '2026-09-17',
          label: 'Today',
          entries: [entry({ dealId: 'deal-7' })],
          minutes: 164,
        },
      ],
    });
    await renderScreen(<TimesheetScreen {...props} />);

    const rows = screen.getAllByTestId('timesheet-entry');
    expect(rows).toHaveLength(1);
    expect(screen.getByText('Job 1042')).toBeTruthy();
    expect(screen.getByLabelText(/2h 44m, Job 1042/)).toBeTruthy();
  });

  it('says "For the day" for an entry that was on no job', async () => {
    await renderScreen(<TimesheetScreen {...props} />);
    expect(screen.getByText('For the day')).toBeTruthy();
  });

  it('marks the entry that is still running rather than inventing an end', async () => {
    mockTimesheet = timesheet({
      days: [
        {
          dateIso: '2026-09-17',
          label: 'Today',
          entries: [entry({ endedAt: undefined, minutes: undefined })],
          minutes: 0,
        },
      ],
    });
    await renderScreen(<TimesheetScreen {...props} />);
    expect(screen.getByLabelText(/still running/)).toBeTruthy();
  });

  it('offers clocking in and out even when the week could not be read', async () => {
    // The two are independent: the queue takes the tap whether or not the
    // server can answer a question about last Tuesday.
    mockTimesheet = timesheet({
      days: [],
      entries: [],
      error: new ApiError(0, 'Unable to reach the server.'),
    });
    await renderScreen(<TimesheetScreen {...props} />);

    expect(screen.getByTestId('timesheet-error')).toBeTruthy();
    expect(screen.getByText('No signal')).toBeTruthy();
    expect(screen.getByTestId('clock-in')).toBeTruthy();
  });

  it('admits when the hours on screen are the phone’s own copy', async () => {
    mockTimesheet = timesheet({ stale: true, error: new ApiError(0, 'offline') });
    await renderScreen(<TimesheetScreen {...props} />);
    expect(screen.getByTestId('timesheet-stale')).toBeTruthy();
  });

  it('says so when a clock entry never reached the office', async () => {
    // Nothing else on this screen would: the clock simply reads "not on the
    // clock", which looks like the technician forgot.
    mockFailed = [
      {
        queue: 'outbox',
        id: 'row-1',
        userId: 'tech-1',
        kind: 'timeclock_in',
        dealId: '',
        payload: '{}',
        createdAt: 1,
        attempts: 5,
        nextAttemptAt: 0,
        lastError: 'Job already closed',
        state: 'failed',
      },
    ];
    const onOpenQueue = jest.fn();
    await renderScreen(<TimesheetScreen {...props} onOpenQueue={onOpenQueue} />);

    expect(screen.getByTestId('clock-failed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('clock-open-queue'));
    expect(onOpenQueue).toHaveBeenCalledTimes(1);
  });

  it('has nothing to show when the week is empty, and says that too', async () => {
    mockTimesheet = timesheet({ days: [], entries: [], todayMinutes: 0, weekMinutes: 0 });
    await renderScreen(<TimesheetScreen {...props} />);
    expect(screen.getByTestId('timesheet-empty')).toBeTruthy();
  });

  it('goes back where it came from', async () => {
    await renderScreen(<TimesheetScreen {...props} />);
    await fireEvent.press(screen.getByTestId('timesheet-back'));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
