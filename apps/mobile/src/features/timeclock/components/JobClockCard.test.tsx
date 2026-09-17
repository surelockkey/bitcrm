import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../../test/render';
import type { ClockState } from '../lib';
import type { TimeClockEntry } from '../types';
import { JobClockCard } from './JobClockCard';

const mockClockIn = jest.fn().mockResolvedValue(undefined);
const mockClockOut = jest.fn().mockResolvedValue(undefined);
let mockState: ClockState = { status: 'off' };

jest.mock('../hooks', () => ({
  useClockState: () => ({
    state: mockState,
    failed: [],
    isLoading: false,
    refetch: jest.fn(),
  }),
  useClockActions: () => ({ clockIn: mockClockIn, clockOut: mockClockOut }),
  useDealNumber: (dealId: string | undefined) =>
    dealId === 'deal-7' ? '1042' : undefined,
}));

const running = (dealId?: string): TimeClockEntry => ({
  id: 'e1',
  userId: 'tech-1',
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  source: 'mobile',
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
  ...(dealId ? { dealId } : {}),
});

beforeEach(() => {
  mockState = { status: 'off' };
  mockClockIn.mockClear();
  mockClockOut.mockClear();
});

describe('JobClockCard', () => {
  it('keeps Workiz’s word for it: the button says Start (§1.4)', async () => {
    await renderScreen(<JobClockCard dealId="deal-7" />);
    expect(screen.getByLabelText('Start')).toBeTruthy();
  });

  it('starts the clock on this job, not on the day', async () => {
    await renderScreen(<JobClockCard dealId="deal-7" />);
    await fireEvent.press(screen.getByTestId('clock-in'));
    expect(mockClockIn).toHaveBeenCalledWith('deal-7');
  });

  it('shows the running clock, and only the way out, when it is on this job', async () => {
    mockState = { status: 'on', entry: running('deal-7') };
    await renderScreen(<JobClockCard dealId="deal-7" />);

    expect(screen.getByTestId('clock-out')).toBeTruthy();
    expect(screen.queryByTestId('clock-elsewhere')).toBeNull();
  });

  it('names the job the clock is already running on', async () => {
    // Otherwise a technician taps Start here, sees a running clock, and assumes
    // it is this job's.
    mockState = { status: 'on', entry: running('deal-7') };
    await renderScreen(<JobClockCard dealId="deal-99" />);

    expect(screen.getByTestId('clock-elsewhere')).toHaveTextContent(
      /already running on job 1042/,
    );
  });

  it('says plainly when the clock is running for the day rather than on a job', async () => {
    mockState = { status: 'on', entry: running() };
    await renderScreen(<JobClockCard dealId="deal-99" />);

    expect(screen.getByTestId('clock-elsewhere')).toHaveTextContent(
      /running for the day/,
    );
  });
});
