import { fireEvent, screen } from '@testing-library/react-native';
import { renderScreen } from '../../test/render';
import { dayMarks, visitsOn } from '../jobs/calendar';
import { groupJobsByDay } from '../jobs/lib';
import { JobSuperStatus, type Deal } from '../jobs/types';
import type { UseMyJobsResult } from '../jobs/hooks';
import { HomeScreen } from './home-screen';

const TODAY = '2026-09-17';
const NOW = Date.parse('2026-09-17T12:00:00.000Z');

const mockRefetch = jest.fn();
const mockCall = jest.fn();
let mockJobs: UseMyJobsResult;
let mockMe: { firstName?: string; department?: string } | undefined;

jest.mock('../jobs/hooks', () => ({
  useMyJobs: () => mockJobs,
  useMe: () => ({ data: mockMe }),
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

function result(over: Partial<UseMyJobsResult> = {}): UseMyJobsResult {
  const deals = over.deals ?? [];
  return {
    deals,
    groups: groupJobsByDay(deals, TODAY, 't1'),
    techId: 't1',
    ready: true,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: mockRefetch,
    updatedAt: NOW - 4 * 60_000,
    marks: dayMarks(deals, TODAY),
    selectedVisits: visitsOn(deals, TODAY),
    ...over,
  };
}

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    mockRefetch.mockReset();
    mockCall.mockReset();
    mockMe = { firstName: 'Dana', department: 'Sure Lock & Key' };
    mockJobs = result({ deals: [deal()] });
  });

  afterEach(() => jest.useRealTimers());

  const render = (scheme?: 'light' | 'dark') =>
    renderScreen(
      <HomeScreen onOpenJob={jest.fn()} onViewAll={jest.fn()} todayIso={TODAY} />,
      scheme ? { scheme } : undefined,
    );

  it.each(['light', 'dark'] as const)('renders in the %s theme', async (scheme) => {
    await render(scheme);
    expect(screen.getByTestId('home-screen')).toBeTruthy();
  });

  /** Workiz's own line, because it is the first thing on their Home (§3). */
  it('greets the technician by name', async () => {
    await render();
    expect(screen.getByText('Hey Dana, here is your upcoming day')).toBeTruthy();
  });

  it('is a dashboard, not the day list', async () => {
    mockJobs = result({ deals: [deal({ id: 'a' }), deal({ id: 'b', dealNumber: '1002' })] });
    await render();
    expect(screen.queryByTestId('jobs-list')).toBeNull();
    // One card — the next job — not both of them.
    expect(screen.getByTestId('job-card-a')).toBeTruthy();
    expect(screen.queryByTestId('job-card-b')).toBeNull();
  });

  it('leads with Upcoming work and the next job on it', async () => {
    await render();
    expect(screen.getByText('Upcoming work')).toBeTruthy();
    expect(screen.getByTestId('job-card-d1')).toBeTruthy();
  });

  it('says plainly when there is nothing on the schedule', async () => {
    mockJobs = result({ deals: [] });
    await render();
    expect(screen.getByTestId('home-upcoming-empty')).toBeTruthy();
    expect(screen.getByText('Nothing on your schedule.')).toBeTruthy();
  });

  it('opens the job from the Upcoming work card', async () => {
    const onOpenJob = jest.fn();
    await renderScreen(
      <HomeScreen onOpenJob={onOpenJob} onViewAll={jest.fn()} todayIso={TODAY} />,
    );
    await fireEvent.press(screen.getByTestId('job-card-d1'));
    expect(onOpenJob).toHaveBeenCalledWith('d1');
  });

  describe('the widget', () => {
    it('counts the technician’s own jobs by status', async () => {
      mockJobs = result({
        deals: [
          deal({ id: 'a' }),
          deal({ id: 'b' }),
          deal({ id: 'c', superStatus: JobSuperStatus.IN_PROGRESS }),
        ],
      });
      await render();
      expect(screen.getByLabelText('Submitted, 2')).toBeTruthy();
      expect(screen.getByLabelText('In progress, 1')).toBeTruthy();
    });

    /**
     * The number above it may be an hour old — the day list is served from a
     * cache that survives being underground — so the widget has to be able to
     * say when it was last right.
     */
    it('says how old the numbers are', async () => {
      await render();
      expect(screen.getByTestId('home-widget-updated')).toHaveTextContent(
        'Updated 4 minutes ago',
      );
    });

    it('has never been updated before the first answer comes back', async () => {
      mockJobs = result({ deals: [deal()], updatedAt: 0 });
      await render();
      expect(screen.getByTestId('home-widget-updated')).toHaveTextContent(
        'Not updated yet',
      );
    });

    it('refreshes on demand', async () => {
      await render();
      await fireEvent.press(screen.getByTestId('home-widget-refresh'));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it('sends View all to the Schedule tab', async () => {
      const onViewAll = jest.fn();
      await renderScreen(
        <HomeScreen onOpenJob={jest.fn()} onViewAll={onViewAll} todayIso={TODAY} />,
      );
      await fireEvent.press(screen.getByTestId('home-widget-view-all'));
      expect(onViewAll).toHaveBeenCalledTimes(1);
    });

    it('says as little as Workiz does when there is nothing to count', async () => {
      mockJobs = result({ deals: [] });
      await render();
      expect(screen.getByTestId('home-widget-empty')).toHaveTextContent(
        'No jobs to count yet.',
      );
    });
  });

  it('shows a loading screen, not an empty day, until the technician is known', async () => {
    mockJobs = result({ ready: false, isLoading: true, deals: [] });
    await render();
    expect(screen.getByTestId('splash')).toBeTruthy();
    expect(screen.queryByTestId('home-greeting')).toBeNull();
  });

  it('carries the burger, so the menu is reachable from the first screen', async () => {
    await render();
    expect(screen.getByTestId('open-menu')).toBeTruthy();
  });
});
