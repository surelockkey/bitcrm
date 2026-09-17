import { JobSuperStatus, type Deal } from '../jobs/types';
import {
  greeting,
  nextJob,
  statusCounts,
  totalOf,
  updatedAgoLabel,
} from './lib';

const TODAY = '2026-09-17';

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: '1001',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  scheduledDate: TODAY,
  scheduledTimeSlot: '09:00-12:00',
  ...over,
});

describe('greeting', () => {
  it('uses Workiz’s own line, with the technician’s first name', () => {
    expect(greeting('Bohdan')).toBe('Hey Bohdan, here is your upcoming day');
  });

  it('still greets somebody the office never gave a first name', () => {
    expect(greeting(undefined)).toBe('Here is your upcoming day');
    expect(greeting('   ')).toBe('Here is your upcoming day');
  });
});

describe('nextJob', () => {
  it('is the earliest open job today, by slot', () => {
    const jobs = [
      deal({ id: 'late', scheduledTimeSlot: '15:00-17:00' }),
      deal({ id: 'early', scheduledTimeSlot: '08:00-10:00' }),
    ];
    expect(nextJob(jobs, TODAY)?.id).toBe('early');
  });

  /**
   * The route position a dispatcher set beats the clock, the same way the day
   * list orders itself — the card on Home must be the card at the top of the
   * list, or the two screens disagree about where to go next.
   */
  it('follows the dispatcher’s own visit order when there is one', () => {
    const jobs = [
      deal({ id: 'second', scheduledTimeSlot: '08:00-10:00', sequences: { t1: 2 } }),
      deal({ id: 'first', scheduledTimeSlot: '15:00-17:00', sequences: { t1: 1 } }),
    ];
    expect(nextJob(jobs, TODAY, 't1')?.id).toBe('first');
  });

  it('skips work that is already finished with', () => {
    const jobs = [
      deal({ id: 'done', scheduledTimeSlot: '08:00-10:00', superStatus: JobSuperStatus.DONE }),
      deal({
        id: 'canceled',
        scheduledTimeSlot: '09:00-10:00',
        superStatus: JobSuperStatus.CANCELED,
      }),
      deal({ id: 'open', scheduledTimeSlot: '15:00-17:00' }),
    ];
    expect(nextJob(jobs, TODAY)?.id).toBe('open');
  });

  /**
   * An open job dated last week is a problem to chase, not the next stop. Put
   * under a heading reading "Upcoming work" it would be a sentence the
   * technician has to decode before trusting anything else on the screen.
   */
  it('does not call a job from a day already gone "upcoming"', () => {
    const jobs = [deal({ id: 'overdue', scheduledDate: '2026-09-10' })];
    expect(nextJob(jobs, TODAY)).toBeUndefined();
  });

  it('looks past today when today is empty', () => {
    const jobs = [deal({ id: 'friday', scheduledDate: '2026-09-19' })];
    expect(nextJob(jobs, TODAY)?.id).toBe('friday');
  });

  it('has no answer when nothing is dated at all', () => {
    expect(nextJob([deal({ scheduledDate: undefined })], TODAY)).toBeUndefined();
    expect(nextJob([], TODAY)).toBeUndefined();
  });
});

describe('statusCounts', () => {
  it('counts the day list, in a fixed order, skipping the empty statuses', () => {
    const jobs = [
      deal({ id: 'a' }),
      deal({ id: 'b' }),
      deal({ id: 'c', superStatus: JobSuperStatus.IN_PROGRESS }),
    ];
    const counts = statusCounts(jobs, TODAY);

    expect(counts.map((c) => [c.label, c.count])).toEqual([
      ['Submitted', 2],
      ['In progress', 1],
    ]);
    expect(totalOf(counts)).toBe(3);
  });

  /**
   * The count has to be over what the technician can see, or it is a number
   * nobody can tie to anything. `groupJobsByDay` drops closed work from every
   * day but today, so last month's finished jobs are not counted — but a job
   * finished this morning is, because it is still on the list.
   */
  it('counts what the day list shows and nothing else', () => {
    const jobs = [
      deal({ id: 'old', scheduledDate: '2026-08-01', superStatus: JobSuperStatus.DONE }),
      deal({ id: 'today-done', superStatus: JobSuperStatus.DONE }),
      deal({ id: 'overdue-open', scheduledDate: '2026-09-10' }),
      deal({ id: 'undated', scheduledDate: undefined }),
    ];
    const counts = statusCounts(jobs, TODAY);

    expect(totalOf(counts)).toBe(3);
    expect(counts.find((c) => c.label === 'Done')?.count).toBe(1);
    expect(counts.find((c) => c.label === 'Submitted')?.count).toBe(2);
  });

  it('counts a status this build has never heard of rather than losing it', () => {
    const jobs = [deal({ id: 'x', superStatus: 'invented' as JobSuperStatus })];
    const counts = statusCounts(jobs, TODAY);
    expect(counts).toEqual([{ status: 'invented', label: 'invented', count: 1 }]);
  });

  it('is empty when the day list is', () => {
    expect(statusCounts([], TODAY)).toEqual([]);
    expect(totalOf([])).toBe(0);
  });
});

describe('updatedAgoLabel', () => {
  const now = Date.parse('2026-09-17T12:00:00.000Z');

  it.each([
    [0, 'Not updated yet'],
    [now - 10_000, 'Updated just now'],
    [now - 61_000, 'Updated 1 minute ago'],
    [now - 4 * 60_000, 'Updated 4 minutes ago'],
    [now - 59 * 60_000, 'Updated 59 minutes ago'],
    [now - 3 * 3_600_000, 'Updated over an hour ago'],
  ])('reads %p as %p', (updatedAt, expected) => {
    expect(updatedAgoLabel(updatedAt, now)).toBe(expected);
  });

  /**
   * A phone whose clock is a few seconds behind the server's would otherwise
   * be told the list was refreshed in the future.
   */
  it('never counts backwards', () => {
    expect(updatedAgoLabel(now + 30_000, now)).toBe('Updated just now');
  });
});
