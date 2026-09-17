import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { ApiError } from '../../lib/api/errors';
import { dayMarks, dayNavTitle, visitsOn } from './calendar';
import { JobsScreen } from './jobs-screen';
import { groupJobsByDay, groupJobsForDay, localDateIso, shiftDateIso } from './lib';
import { JobSuperStatus, type Deal } from './types';
import type { UseMyJobsResult } from './hooks';

const mockCall = jest.fn();
const mockRefetch = jest.fn();
let mockJobs: UseMyJobsResult;
/** What the screen asked the hook for, most recent last: `[today, selected]`. */
let mockAsked: [string, string][] = [];
/**
 * What the hook answers. The default ignores the day and hands back the
 * fixture; the day-navigation tests replace it with one that answers for the
 * day it was asked about, which is the whole point of that feature.
 */
let mockAnswer: (today: string, selected: string) => UseMyJobsResult;

jest.mock('./hooks', () => ({
  useMyJobs: (today: string, selected: string) => {
    mockAsked.push([today, selected]);
    return mockAnswer(today, selected);
  },
}));
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
    marks: dayMarks(deals, '2026-09-16'),
    selectedVisits: visitsOn(deals, '2026-09-16'),
    ...over,
  };
}

describe('JobsScreen', () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockRefetch.mockReset();
    mockAsked = [];
    mockJobs = result();
    mockAnswer = () => mockJobs;
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

/**
 * Moving between days (§1.3).
 *
 * Dates here are relative to the device's real "today", because that is what
 * the screen reads — pinning a date would test the fixture instead.
 */
describe('JobsScreen — moving between days', () => {
  const today = localDateIso();
  const tomorrow = shiftDateIso(today, 1);
  const yesterday = shiftDateIso(today, -1);

  /** A hook that answers for whichever day it is asked about. */
  const dayAware = (deals: Deal[]) => (todayIso: string, selected: string) =>
    result({
      deals,
      groups: groupJobsForDay(deals, selected, todayIso, 't1'),
      marks: dayMarks(deals, todayIso),
      selectedVisits: visitsOn(deals, selected),
    });

  beforeEach(() => {
    mockCall.mockReset();
    mockRefetch.mockReset();
    mockAsked = [];
    mockJobs = result();
    mockAnswer = () => mockJobs;
  });

  it('opens on today, and says how many visits it holds', async () => {
    mockAnswer = dayAware([
      deal({ id: 'a', scheduledDate: today }),
      deal({ id: 'b', scheduledDate: today, dealNumber: 'B' }),
    ]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    expect(screen.getByTestId('day-bar')).toBeTruthy();
    expect(screen.getByText('Today · 2 visits')).toBeTruthy();
    // The bar carries the date; the list heads its groups. Neither repeats the
    // other, so "Today" on screen is the section, not the navigation.
    expect(screen.getByText(dayNavTitle(today))).toBeTruthy();
    expect(mockAsked.at(-1)).toEqual([today, today]);
  });

  it('steps forward and back a day at a time', async () => {
    mockAnswer = dayAware([]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('day-next'));
    expect(mockAsked.at(-1)).toEqual([today, tomorrow]);

    await fireEvent.press(screen.getByTestId('day-prev'));
    await fireEvent.press(screen.getByTestId('day-prev'));
    expect(mockAsked.at(-1)).toEqual([today, yesterday]);
  });

  it('shows the day it moved to, not the day it came from', async () => {
    mockAnswer = dayAware([
      deal({ id: 'now', scheduledDate: today, scheduledTimeSlot: '09:00-12:00' }),
      deal({
        id: 'next',
        dealNumber: 'NEXT',
        scheduledDate: tomorrow,
        scheduledTimeSlot: '14:00-16:00',
        clientName: { firstName: 'Grace', lastName: 'Hopper' },
      }),
    ]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);
    expect(screen.getByTestId('job-card-now')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('day-next'));

    expect(screen.getByText('Tomorrow')).toBeTruthy();
    expect(screen.getByTestId('job-card-next')).toBeTruthy();
    // Today's own jobs are gone: a day at a time, once off today (§1.3).
    expect(screen.queryByTestId('job-card-now')).toBeNull();
  });

  // The whole assigned set is downloaded once and kept; moving days must not
  // send the phone back to the network for a list it already has.
  it('changes the day without refetching anything', async () => {
    mockAnswer = dayAware([]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('day-next'));
    await fireEvent.press(screen.getByTestId('day-next'));

    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it('offers the way back to today only once the technician has left it', async () => {
    mockAnswer = dayAware([]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);
    expect(screen.queryByTestId('day-today')).toBeNull();

    await fireEvent.press(screen.getByTestId('day-next'));
    await fireEvent.press(screen.getByTestId('day-today'));

    expect(mockAsked.at(-1)).toEqual([today, today]);
    expect(screen.queryByTestId('day-today')).toBeNull();
  });

  it('says the day is empty rather than showing nothing at all', async () => {
    mockAnswer = dayAware([deal({ scheduledDate: today })]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('day-next'));

    expect(screen.getByText('Tomorrow · No visits')).toBeTruthy();
    expect(screen.getByText('Nothing booked. Dispatch will let you know.')).toBeTruthy();
  });

  // What a swipe *decides* is `daySwipeHandlers`, tested against its own
  // vectors in calendar.test.ts; what matters here is that the list is
  // actually wrapped in a responder rather than only the arrows working.
  it('puts the list inside a swipe responder', async () => {
    mockAnswer = dayAware([]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    const swipe = screen.getByTestId('jobs-swipe');
    expect(typeof swipe.props.onMoveShouldSetResponder).toBe('function');
    expect(typeof swipe.props.onResponderRelease).toBe('function');
  });

  it('opens the calendar and lands on the day picked from it', async () => {
    mockAnswer = dayAware([deal({ id: 'far', scheduledDate: '2027-03-04' })]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('day-open-calendar'));
    expect(screen.getByTestId('day-picker')).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`day-${tomorrow}`));
    expect(mockAsked.at(-1)).toEqual([today, tomorrow]);
  });

  it('closes the calendar without moving the day when it is cancelled', async () => {
    mockAnswer = dayAware([]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('day-open-calendar'));
    await fireEvent.press(screen.getByTestId('day-picker-cancel'));

    expect(mockAsked.at(-1)).toEqual([today, today]);
  });

  it('pages the calendar by month', async () => {
    mockAnswer = dayAware([]);
    await renderScreen(<JobsScreen onOpenJob={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('day-open-calendar'));
    const start = screen.getByTestId('month-label').props.children;

    await fireEvent.press(screen.getByTestId('month-next'));
    expect(screen.getByTestId('month-label').props.children).not.toBe(start);

    await fireEvent.press(screen.getByTestId('month-prev'));
    expect(screen.getByTestId('month-label').props.children).toBe(start);
  });
});
