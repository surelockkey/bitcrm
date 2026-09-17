import { JobSuperStatus, type Deal } from '../jobs/types';
import {
  DEFAULT_GRID_FROM,
  DEFAULT_GRID_TO,
  blockLabel,
  gridRange,
  hourLabel,
  isFiltering,
  jobCountLabel,
  jobsOnDay,
  layoutDay,
  makeMatcher,
  monthTitle,
  parseSlotMinutes,
  searchMatch,
  statusOptions,
  weekOf,
  weekStartIso,
  NO_FILTER,
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
  clientName: { firstName: 'Ada', lastName: 'Byron' },
  ...over,
});

describe('hourLabel', () => {
  it.each([
    [0, '12am'],
    [7, '7am'],
    [11, '11am'],
    [12, '12pm'],
    [13, '1pm'],
    [23, '11pm'],
  ])('writes %p as %p, the way Workiz does', (hour, expected) => {
    expect(hourLabel(hour)).toBe(expected);
  });
});

describe('parseSlotMinutes', () => {
  it('reads a slot as minutes since midnight', () => {
    expect(parseSlotMinutes('09:30-11:30')).toEqual({ start: 570, end: 690 });
  });

  /**
   * A bare start, or an end that is not after it, still has to draw as a block
   * a thumb can hit — an hour, which is what a dispatcher means by a time.
   */
  it.each(['09:00', '09:00-09:00', '09:00-08:00'])(
    'gives %p an hour of its own',
    (slot) => {
      expect(parseSlotMinutes(slot)).toEqual({ start: 540, end: 600 });
    },
  );

  it.each([undefined, '', 'morning', '25:00-26:00', '09:70-10:00'])(
    'refuses %p rather than guessing',
    (slot) => {
      expect(parseSlotMinutes(slot)).toBeNull();
    },
  );
});

describe('gridRange', () => {
  it('opens on the working day', () => {
    expect(gridRange([deal()])).toEqual({ from: DEFAULT_GRID_FROM, to: DEFAULT_GRID_TO });
  });

  /**
   * A grid that cropped either end would hide a job completely, which is the
   * worst thing a schedule can do.
   */
  it('widens for an early start and a late finish', () => {
    const range = gridRange([
      deal({ id: 'dawn', scheduledTimeSlot: '05:30-07:00' }),
      deal({ id: 'night', scheduledTimeSlot: '21:00-22:30' }),
    ]);
    expect(range).toEqual({ from: 5, to: 23 });
  });

  it('ignores all-day and untimed work, which is not on the grid at all', () => {
    expect(gridRange([deal({ allDay: true, scheduledTimeSlot: '05:00-06:00' })])).toEqual({
      from: DEFAULT_GRID_FROM,
      to: DEFAULT_GRID_TO,
    });
    expect(gridRange([deal({ scheduledTimeSlot: undefined })])).toEqual({
      from: DEFAULT_GRID_FROM,
      to: DEFAULT_GRID_TO,
    });
  });
});

describe('layoutDay', () => {
  it('places a timed job and hands back the ones it cannot', () => {
    const { placed, unplaced } = layoutDay([
      deal({ id: 'timed' }),
      deal({ id: 'allday', allDay: true }),
      deal({ id: 'untimed', scheduledTimeSlot: undefined }),
    ]);

    expect(placed.map((p) => p.deal.id)).toEqual(['timed']);
    expect(placed[0]).toMatchObject({ startMin: 540, endMin: 720, column: 0, columns: 1 });
    expect(unplaced.map((d) => d.id)).toEqual(['allday', 'untimed']);
  });

  /**
   * Two jobs in the same window is normal — a dispatcher double-books and
   * sorts it out on the phone. Stacking them would hide one entirely.
   */
  it('puts overlapping jobs side by side', () => {
    const { placed } = layoutDay([
      deal({ id: 'a', scheduledTimeSlot: '09:00-11:00' }),
      deal({ id: 'b', scheduledTimeSlot: '10:00-12:00' }),
    ]);
    expect(placed.map((p) => [p.deal.id, p.column, p.columns])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
    ]);
  });

  /** One clash at 9am must not squeeze a lone 4pm job into half the width. */
  it('counts lanes per clash, not per day', () => {
    const { placed } = layoutDay([
      deal({ id: 'a', scheduledTimeSlot: '09:00-11:00' }),
      deal({ id: 'b', scheduledTimeSlot: '10:00-12:00' }),
      deal({ id: 'alone', scheduledTimeSlot: '16:00-17:00' }),
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.deal.id, p]));
    expect(byId.a.columns).toBe(2);
    expect(byId.b.columns).toBe(2);
    expect(byId.alone.columns).toBe(1);
    expect(byId.alone.column).toBe(0);
  });

  it('reuses a lane once the job in it has finished', () => {
    const { placed } = layoutDay([
      deal({ id: 'a', scheduledTimeSlot: '09:00-10:00' }),
      deal({ id: 'b', scheduledTimeSlot: '09:30-11:00' }),
      deal({ id: 'c', scheduledTimeSlot: '10:00-11:00' }),
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.deal.id, p]));
    // `c` starts as `a` ends, so it takes `a`'s lane rather than a third one.
    expect(byId.c.column).toBe(0);
    expect(byId.c.columns).toBe(2);
  });

  it('sorts the blocks by when they start', () => {
    const { placed } = layoutDay([
      deal({ id: 'pm', scheduledTimeSlot: '15:00-16:00' }),
      deal({ id: 'am', scheduledTimeSlot: '08:00-09:00' }),
    ]);
    expect(placed.map((p) => p.deal.id)).toEqual(['am', 'pm']);
  });
});

describe('blockLabel', () => {
  /** A screen reader cannot read a position on a canvas; it reads this. */
  it('says the time, the client and the status', () => {
    expect(blockLabel(deal())).toBe('9:00 AM – 12:00 PM, Ada Byron, Submitted');
  });

  it('falls back to the job number when nobody named the client', () => {
    expect(blockLabel(deal({ clientName: undefined }))).toBe(
      '9:00 AM – 12:00 PM, Job 1001, Submitted',
    );
  });
});

describe('weekOf', () => {
  it('starts the week on Sunday, like the calendar this app already has', () => {
    expect(weekStartIso('2026-09-17')).toBe('2026-09-13');
    const week = weekOf('2026-09-17', '2026-09-17', []);
    expect(week.map((d) => `${d.weekday} ${d.day}`)).toEqual([
      'Sun 13',
      'Mon 14',
      'Tue 15',
      'Wed 16',
      'Thu 17',
      'Fri 18',
      'Sat 19',
    ]);
  });

  it('marks today and the chosen day separately, so both read at once', () => {
    const week = weekOf('2026-09-19', '2026-09-17', []);
    expect(week.find((d) => d.iso === '2026-09-17')).toMatchObject({
      isToday: true,
      isSelected: false,
    });
    expect(week.find((d) => d.iso === '2026-09-19')).toMatchObject({
      isToday: false,
      isSelected: true,
    });
  });

  it('counts the visits on each day', () => {
    const week = weekOf('2026-09-17', '2026-09-17', [
      deal({ id: 'a' }),
      deal({ id: 'b' }),
      deal({ id: 'c', scheduledDate: '2026-09-18' }),
      deal({ id: 'undated', scheduledDate: undefined }),
    ]);
    expect(week.find((d) => d.iso === '2026-09-17')?.visits).toBe(2);
    expect(week.find((d) => d.iso === '2026-09-18')?.visits).toBe(1);
    expect(week.find((d) => d.iso === '2026-09-13')?.visits).toBe(0);
  });

  it('crosses a month boundary without losing a day', () => {
    const week = weekOf('2026-10-01', '2026-10-01', []);
    expect(week.map((d) => d.iso)).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });
});

describe('monthTitle', () => {
  it('is the month alone, as Workiz’s header writes it', () => {
    expect(monthTitle('2026-09-17')).toBe('September');
  });
});

describe('filter and search', () => {
  const jobs = [
    deal({ id: 'a' }),
    deal({ id: 'b', superStatus: JobSuperStatus.DONE }),
    deal({
      id: 'c',
      dealNumber: '2002',
      clientName: { firstName: 'Grace', lastName: 'Hopper' },
      address: { street: '9 Elm Ave', city: 'New Haven', state: 'CT', zip: '06510' },
    }),
  ];

  it('offers only statuses the technician actually has, with counts', () => {
    expect(statusOptions(jobs)).toEqual([
      { status: JobSuperStatus.DONE, label: 'Done', count: 1 },
      { status: JobSuperStatus.SUBMITTED, label: 'Submitted', count: 2 },
    ]);
  });

  it('finds a job by number, client or street, whatever the case', () => {
    expect(searchMatch(jobs[2], '2002')).toBe(true);
    expect(searchMatch(jobs[2], 'grace')).toBe(true);
    expect(searchMatch(jobs[2], 'ELM')).toBe(true);
    expect(searchMatch(jobs[2], 'nowhere')).toBe(false);
  });

  it('matches everything when nothing has been typed', () => {
    expect(searchMatch(jobs[0], '   ')).toBe(true);
  });

  it('narrows nothing until somebody sets it', () => {
    const match = makeMatcher(NO_FILTER, '');
    expect(jobs.filter(match)).toHaveLength(3);
    expect(isFiltering(NO_FILTER, '')).toBe(false);
    expect(isFiltering(NO_FILTER, 'ada')).toBe(true);
    expect(isFiltering({ statuses: [JobSuperStatus.DONE] }, '')).toBe(true);
  });

  it('applies the status and the search together', () => {
    const match = makeMatcher({ statuses: [JobSuperStatus.SUBMITTED] }, 'grace');
    expect(jobs.filter(match).map((d) => d.id)).toEqual(['c']);
  });
});

describe('jobsOnDay', () => {
  it('is that one day, filtered, in visit order', () => {
    const jobs = [
      deal({ id: 'late', scheduledTimeSlot: '15:00-16:00' }),
      deal({ id: 'early', scheduledTimeSlot: '08:00-09:00' }),
      deal({ id: 'other', scheduledDate: '2026-09-18' }),
      deal({ id: 'done', superStatus: JobSuperStatus.DONE }),
    ];
    const match = makeMatcher({ statuses: [JobSuperStatus.SUBMITTED] }, '');
    expect(jobsOnDay(jobs, TODAY, match).map((d) => d.id)).toEqual(['early', 'late']);
  });
});

describe('jobCountLabel', () => {
  it.each([
    [0, 'No jobs'],
    [1, '1 job'],
    [4, '4 jobs'],
  ])('says %p as %p rather than leaving it to a dot', (count, expected) => {
    expect(jobCountLabel(count)).toBe(expected);
  });
});
