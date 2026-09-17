import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { ApiError } from '../../lib/api/errors';
import { JobsScreen } from './jobs-screen';
import { groupJobsByDay } from './lib';
import { JobSuperStatus, type Deal } from './types';
import type { UseMyJobsResult } from './hooks';

const mockCall = jest.fn();
const mockRefetch = jest.fn();
let mockJobs: UseMyJobsResult;

jest.mock('./hooks', () => ({ useMyJobs: () => mockJobs }));
jest.mock('../telephony/use-masked-call', () => ({
  useMaskedCall: () => ({ mutate: mockCall, isPending: false }),
}));

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: 'A1B2C3',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  scheduledDate: '2026-09-16',
  scheduledTimeSlot: '09:00-12:00',
  clientName: { firstName: 'Ada', lastName: 'Byron' },
  createdAt: '2026-09-15T12:00:00.000Z',
  ...over,
});

function result(over: Partial<UseMyJobsResult> = {}): UseMyJobsResult {
  const deals = over.deals ?? [];
  return {
    deals,
    groups: groupJobsByDay(deals, '2026-09-16', 't1'),
    techId: 't1',
    ready: true,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: mockRefetch,
    ...over,
  };
}

describe('JobsScreen', () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockRefetch.mockReset();
    mockJobs = result();
  });

  it.each(['light', 'dark'] as const)('renders the day list in the %s theme', async (scheme) => {
    mockJobs = result({ deals: [deal()] });
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />, { scheme });

    expect(screen.getByTestId('jobs-list')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('9:00 AM – 12:00 PM')).toBeTruthy();
    expect(screen.getByText('Ada Byron')).toBeTruthy();
    expect(screen.getByText('1 Main St, Hartford, CT 06103')).toBeTruthy();
  });

  it('says the day is empty rather than showing nothing at all', async () => {
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Nothing booked. Dispatch will let you know.')).toBeTruthy();
  });

  it('opens the job when the card is tapped', async () => {
    const onOpenJob = jest.fn();
    mockJobs = result({ deals: [deal({ id: 'job-7' })] });
    await renderScreen(<JobsScreen onOpenJob={onOpenJob} />);

    await fireEvent.press(screen.getByTestId('job-card-job-7'));
    expect(onOpenJob).toHaveBeenCalledWith('job-7');
  });

  it('calls the client through the bridge — by job and contact, never by number', async () => {
    mockJobs = result({ deals: [deal({ id: 'job-7', contactId: 'contact-9' })] });
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    await fireEvent.press(screen.getByLabelText('Call client'));
    expect(mockCall).toHaveBeenCalledWith({ dealId: 'job-7', contactId: 'contact-9' });
  });

  it('offers no Navigate button for a job with no address at all', async () => {
    mockJobs = result({
      deals: [deal({ address: { street: '', city: '', state: '', zip: '' } })],
    });
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    expect(screen.getByLabelText('Navigate').props.accessibilityState.disabled).toBe(true);
  });

  it('shows a loading screen, not an empty day, until the technician is known', async () => {
    mockJobs = result({ ready: false, isLoading: true });
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    expect(screen.getByTestId('splash')).toBeTruthy();
    expect(screen.queryByTestId('jobs-list')).toBeNull();
  });

  it('explains a failure with nothing cached, and offers a retry', async () => {
    mockJobs = result({ error: new ApiError(0, 'no signal') });
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    expect(screen.getByTestId('jobs-error')).toBeTruthy();
    expect(screen.getByText('No signal')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('keeps yesterday’s downloaded list on screen when the refresh fails', async () => {
    mockJobs = result({ deals: [deal()], error: new ApiError(503, 'gateway down') });
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    // The list is still there — a technician underground keeps their day.
    expect(screen.getByTestId('jobs-list')).toBeTruthy();
    expect(screen.queryByTestId('jobs-error')).toBeNull();
    expect(
      screen.getByText(/last list this phone downloaded/),
    ).toBeTruthy();
  });
});
