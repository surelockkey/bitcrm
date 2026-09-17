import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { dayMarks, visitsOn } from '../jobs/calendar';
import { groupJobsForDay } from '../jobs/lib';
import { JobSuperStatus, type Deal } from '../jobs/types';
import type { UseMyJobsResult } from '../jobs/hooks';
import { ScheduleScreen } from './schedule-screen';

const TODAY = '2026-09-17';

const mockRefetch = jest.fn();
const mockCall = jest.fn();
let mockDeals: Deal[] = [];
/** What the screen asked for, most recent last: `[today, selected]`. */
let mockAsked: [string, string][] = [];

/**
 * The hook's answer, built outside the `jest.mock` factory — a factory may not
 * reach out of its own scope for anything that is not `mock`-prefixed, and
 * this needs the real grouping: the point of these tests is that the day, the
 * filter and the two modes all agree about the same jobs.
 */
const mockAnswer = (today: string, selected: string): UseMyJobsResult => ({
  deals: mockDeals,
  groups: groupJobsForDay(mockDeals, selected, today, 't1'),
  techId: 't1',
  ready: true,
  isLoading: false,
  isRefetching: false,
  error: null,
  refetch: mockRefetch,
  updatedAt: 0,
  marks: dayMarks(mockDeals, today),
  selectedVisits: visitsOn(mockDeals, selected),
});

jest.mock('../jobs/hooks', () => ({
  useMyJobs: (today: string, selected: string) => {
    mockAsked.push([today, selected]);
    return mockAnswer(today, selected);
  },
  useMe: () => ({ data: { id: 't1', email: 'tech@slk-s.com' } }),
}));
jest.mock('../queue/queue-provider', () => ({ useQueue: () => ({ records: [] }) }));
jest.mock('../telephony/use-masked-call', () => ({
  useMaskedCall: () => ({ mutate: mockCall, isPending: false }),
}));

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: '1001',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  scheduledDate: TODAY,
  scheduledTimeSlot: '09:00-12:00',
  clientName: { firstName: 'Ada', lastName: 'Byron' },
  ...over,
});

const render = (props: Partial<Parameters<typeof ScheduleScreen>[0]> = {}, scheme?: 'light' | 'dark') =>
  renderScreen(
    <ScheduleScreen onOpenJob={jest.fn()} todayIso={TODAY} {...props} />,
    scheme ? { scheme } : undefined,
  );

describe('ScheduleScreen', () => {
  beforeEach(() => {
    mockRefetch.mockReset();
    mockCall.mockReset();
    mockAsked = [];
    mockDeals = [deal()];
  });

  it.each(['light', 'dark'] as const)('renders in the %s theme', async (scheme) => {
    await render({}, scheme);
    expect(screen.getByTestId('schedule-screen')).toBeTruthy();
  });

  /** Workiz's header leads with the month (§4). */
  it('heads the screen with the month, and carries the burger', async () => {
    await render();
    expect(screen.getByText('September')).toBeTruthy();
    expect(screen.getByTestId('open-menu')).toBeTruthy();
  });

  it('offers Workiz’s two modes and opens on the list they already know', async () => {
    await render();
    expect(screen.getByTestId('schedule-mode-timeline')).toBeTruthy();
    expect(screen.getByTestId('schedule-mode-day')).toBeTruthy();
    expect(screen.getByTestId('schedule-timeline')).toBeTruthy();
    expect(screen.queryByTestId('schedule-day')).toBeNull();
  });

  describe('Timeline', () => {
    it('is the day list, with the date rail down the left', async () => {
      await render();
      expect(screen.getByTestId('date-rail')).toBeTruthy();
      expect(screen.getByTestId('jobs-list')).toBeTruthy();
      expect(screen.getByTestId('job-card-d1')).toBeTruthy();
    });

    /** The list's own day bar would be a second set of the same controls. */
    it('leaves the list’s own chrome to Schedule', async () => {
      await render();
      expect(screen.queryByTestId('day-bar')).toBeNull();
      expect(screen.queryByText('My jobs')).toBeNull();
    });

    it('steps a day at a time from the rail', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('rail-next'));
      expect(mockAsked.at(-1)).toEqual([TODAY, '2026-09-18']);

      await fireEvent.press(screen.getByTestId('rail-prev'));
      expect(mockAsked.at(-1)).toEqual([TODAY, TODAY]);
    });

    it('opens the calendar from the date itself', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('rail-date'));
      expect(screen.getByTestId('day-picker')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('day-2026-09-19'));
      expect(mockAsked.at(-1)).toEqual([TODAY, '2026-09-19']);
    });
  });

  describe('Day', () => {
    const openDay = async () => fireEvent.press(screen.getByTestId('schedule-mode-day'));

    it('is a week strip over an hour grid', async () => {
      await render();
      await openDay();
      expect(screen.getByTestId('week-strip')).toBeTruthy();
      expect(screen.getByTestId('hour-grid')).toBeTruthy();
      expect(screen.getByTestId('week-day-2026-09-13')).toBeTruthy();
      expect(screen.getByTestId('week-day-2026-09-19')).toBeTruthy();
    });

    it('draws the working hours, labelled the way Workiz labels them', async () => {
      await render();
      await openDay();
      expect(screen.getByText('11am')).toBeTruthy();
      expect(screen.getByText('12pm')).toBeTruthy();
    });

    it('places the day’s jobs on the grid, each one a way into the job', async () => {
      const onOpenJob = jest.fn();
      await render({ onOpenJob });
      await openDay();
      await fireEvent.press(screen.getByTestId('grid-job-d1'));
      expect(onOpenJob).toHaveBeenCalledWith('d1');
    });

    /**
     * A dated job that simply does not appear on the day it is dated is the
     * worst thing a schedule can do, so the ones that cannot be placed are
     * listed above the grid instead of dropped — which is also the way a
     * screen reader reaches them.
     */
    it('lists the jobs it cannot place rather than losing them', async () => {
      mockDeals = [
        deal({ id: 'allday', allDay: true }),
        deal({ id: 'untimed', scheduledTimeSlot: undefined }),
      ];
      await render();
      await openDay();
      expect(screen.getByTestId('hour-grid-untimed')).toBeTruthy();
      expect(screen.getByTestId('untimed-allday')).toBeTruthy();
      expect(screen.getByTestId('untimed-untimed')).toBeTruthy();
    });

    it('changes the day from the week strip', async () => {
      await render();
      await openDay();
      await fireEvent.press(screen.getByTestId('week-day-2026-09-19'));
      expect(mockAsked.at(-1)).toEqual([TODAY, '2026-09-19']);
    });

    it('says how many jobs the day holds, rather than leaving it to the picture', async () => {
      await render();
      await openDay();
      expect(screen.getByText('1 job')).toBeTruthy();
    });
  });

  it('keeps one day across both modes', async () => {
    await render();
    await fireEvent.press(screen.getByTestId('rail-next'));
    await fireEvent.press(screen.getByTestId('schedule-mode-day'));
    expect(mockAsked.at(-1)).toEqual([TODAY, '2026-09-18']);
  });

  it('goes back to today from the header', async () => {
    await render();
    await fireEvent.press(screen.getByTestId('rail-next'));
    await fireEvent.press(screen.getByTestId('schedule-today'));
    expect(mockAsked.at(-1)).toEqual([TODAY, TODAY]);
  });

  describe('filter and search', () => {
    beforeEach(() => {
      mockDeals = [
        deal({ id: 'open' }),
        deal({
          id: 'done',
          dealNumber: '2002',
          superStatus: JobSuperStatus.DONE,
          clientName: { firstName: 'Grace', lastName: 'Hopper' },
        }),
      ];
    });

    it('narrows the day by status, and says so on the screen', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('schedule-filter'));
      await fireEvent.press(screen.getByTestId(`filter-status-${JobSuperStatus.DONE}`));
      await fireEvent.press(screen.getByTestId('filter-done'));

      expect(screen.getByTestId('job-card-done')).toBeTruthy();
      expect(screen.queryByTestId('job-card-open')).toBeNull();
      expect(screen.getByTestId('schedule-filtered-note')).toBeTruthy();
    });

    it('offers only statuses the technician actually has', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('schedule-filter'));
      expect(screen.getByTestId(`filter-status-${JobSuperStatus.DONE}`)).toBeTruthy();
      expect(
        screen.queryByTestId(`filter-status-${JobSuperStatus.CANCELED}`),
      ).toBeNull();
    });

    it('clears back to the whole day', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('schedule-filter'));
      await fireEvent.press(screen.getByTestId(`filter-status-${JobSuperStatus.DONE}`));
      await fireEvent.press(screen.getByTestId('filter-clear'));
      await fireEvent.press(screen.getByTestId('filter-done'));
      expect(screen.getByTestId('job-card-open')).toBeTruthy();
      expect(screen.getByTestId('job-card-done')).toBeTruthy();
    });

    it('finds a job by client, and the grid agrees with the list', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('schedule-search'));
      await fireEvent.changeText(screen.getByTestId('schedule-search-field'), 'grace');
      expect(screen.queryByTestId('job-card-open')).toBeNull();

      await fireEvent.press(screen.getByTestId('schedule-mode-day'));
      expect(screen.getByTestId('grid-job-done')).toBeTruthy();
      expect(screen.queryByTestId('grid-job-open')).toBeNull();
    });

    /**
     * A day a filter emptied is not a day with no work on it. Telling a
     * technician dispatch has nothing for them when they have simply typed a
     * name into a search box is the kind of wrong that gets phoned in.
     */
    it('says which kind of empty an emptied day is', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('schedule-search'));
      await fireEvent.changeText(screen.getByTestId('schedule-search-field'), 'nobody');

      expect(
        screen.getByText('Nothing on this day matches what you are looking for.'),
      ).toBeTruthy();
      expect(screen.queryByText('Nothing booked. Dispatch will let you know.')).toBeNull();
    });

    it('goes back to dispatch’s own wording once nothing is narrowed', async () => {
      mockDeals = [];
      await render();
      expect(screen.getByText('Nothing booked. Dispatch will let you know.')).toBeTruthy();
    });

    /** A filter nobody can see is a list that is wrong for no visible reason. */
    it('forgets what it found when the field is closed again', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('schedule-search'));
      await fireEvent.changeText(screen.getByTestId('schedule-search-field'), 'grace');
      await fireEvent.press(screen.getByTestId('schedule-search'));

      expect(screen.queryByTestId('schedule-search-field')).toBeNull();
      expect(screen.getByTestId('job-card-open')).toBeTruthy();
    });
  });
});
