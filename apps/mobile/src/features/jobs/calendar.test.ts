import {
  WEEKDAY_LABELS,
  dayAfterRollover,
  dayMarks,
  dayNavCaption,
  dayNavTitle,
  dayRelativeName,
  daySwipeHandlers,
  monthLabel,
  monthMatrix,
  monthOf,
  shiftMonthIso,
  swipeIntent,
  visitCountLabel,
  visitsOn,
} from './calendar';
import { JobSuperStatus, type Deal } from './types';

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  dealNumber: 'A1',
  contactId: 'c1',
  address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
  superStatus: JobSuperStatus.SUBMITTED,
  scheduledDate: '2026-09-17',
  ...over,
});

describe('months', () => {
  it('reads the month off a day', () => {
    expect(monthOf('2026-09-17')).toBe('2026-09');
  });

  it('walks forward and back over a year boundary', () => {
    expect(shiftMonthIso('2026-09', 1)).toBe('2026-10');
    expect(shiftMonthIso('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthIso('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthIso('2026-09', -12)).toBe('2025-09');
  });

  it('names the month the way the sheet heads it', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
  });
});

describe('monthMatrix', () => {
  it('starts the week on Sunday and pads the first row', () => {
    // 1 September 2026 is a Tuesday.
    const rows = monthMatrix('2026-09');
    expect(WEEKDAY_LABELS[0]).toBe('Sun');
    expect(rows[0]!.slice(0, 3)).toEqual([null, null, '2026-09-01']);
  });

  it('gives every row seven cells and the month every one of its days', () => {
    const rows = monthMatrix('2026-09');
    for (const row of rows) expect(row).toHaveLength(7);
    const days = rows.flat().filter(Boolean);
    expect(days).toHaveLength(30);
    expect(days[days.length - 1]).toBe('2026-09-30');
  });

  it('knows a leap February from a common one', () => {
    expect(monthMatrix('2024-02').flat().filter(Boolean)).toHaveLength(29);
    expect(monthMatrix('2026-02').flat().filter(Boolean)).toHaveLength(28);
  });

  it('adds no empty row past the end of the month', () => {
    for (const month of ['2026-01', '2026-02', '2026-09', '2027-08']) {
      for (const row of monthMatrix(month)) {
        expect(row.some(Boolean)).toBe(true);
      }
    }
  });
});

describe('dayMarks', () => {
  const today = '2026-09-17';

  it('counts every job on a day, closed ones included', () => {
    const marks = dayMarks(
      [
        deal({ id: 'a', scheduledDate: '2026-09-18' }),
        deal({ id: 'b', scheduledDate: '2026-09-18', superStatus: JobSuperStatus.DONE }),
      ],
      today,
    );
    expect(marks.get('2026-09-18')).toEqual({ visits: 2, hasOpenPast: false });
  });

  it('flags a past day that still has work open on it — Workiz’s dot', () => {
    const marks = dayMarks([deal({ scheduledDate: '2026-09-15' })], today);
    expect(marks.get('2026-09-15')?.hasOpenPast).toBe(true);
  });

  it('does not flag a past day whose work is finished', () => {
    const marks = dayMarks(
      [deal({ scheduledDate: '2026-09-15', superStatus: JobSuperStatus.DONE })],
      today,
    );
    expect(marks.get('2026-09-15')?.hasOpenPast).toBe(false);
  });

  it('never flags today or a day still to come, however open the job is', () => {
    const marks = dayMarks(
      [
        deal({ id: 'a', scheduledDate: today }),
        deal({ id: 'b', scheduledDate: '2026-09-20' }),
      ],
      today,
    );
    expect(marks.get(today)?.hasOpenPast).toBe(false);
    expect(marks.get('2026-09-20')?.hasOpenPast).toBe(false);
  });

  it('ignores a job nobody has dated', () => {
    const marks = dayMarks([deal({ scheduledDate: undefined })], today);
    expect(marks.size).toBe(0);
  });

  it('reads a full timestamp as the day it falls on', () => {
    const marks = dayMarks(
      [deal({ scheduledDate: '2026-09-18T00:00:00.000Z' })],
      today,
    );
    expect(marks.get('2026-09-18')?.visits).toBe(1);
  });
});

describe('the day counter', () => {
  it('counts the visits on one day', () => {
    const deals = [
      deal({ id: 'a', scheduledDate: '2026-09-17' }),
      deal({ id: 'b', scheduledDate: '2026-09-17' }),
      deal({ id: 'c', scheduledDate: '2026-09-18' }),
    ];
    expect(visitsOn(deals, '2026-09-17')).toBe(2);
    expect(visitsOn(deals, '2026-09-19')).toBe(0);
  });

  it('says it in words, singular and plural', () => {
    expect(visitCountLabel(0)).toBe('No visits');
    expect(visitCountLabel(1)).toBe('1 visit');
    expect(visitCountLabel(4)).toBe('4 visits');
  });
});

describe('the day bar’s wording', () => {
  const today = '2026-09-17';

  it('leads with the date, which the list below never says', () => {
    expect(dayNavTitle(today)).toBe('Thu, Sep 17');
    expect(dayNavTitle('2026-09-23')).toBe('Wed, Sep 23');
  });

  it('names the three days a technician moves between', () => {
    expect(dayRelativeName(today, today)).toBe('Today');
    expect(dayRelativeName('2026-09-18', today)).toBe('Tomorrow');
    expect(dayRelativeName('2026-09-16', today)).toBe('Yesterday');
    expect(dayRelativeName('2026-09-23', today)).toBeNull();
  });

  it('puts the name and the count on the line under it', () => {
    expect(dayNavCaption(today, today, 2)).toBe('Today · 2 visits');
    expect(dayNavCaption('2026-09-23', today, 1)).toBe('1 visit');
    expect(dayNavCaption('2026-09-18', today, 0)).toBe('Tomorrow · No visits');
  });
});

describe('dayAfterRollover', () => {
  it('follows the date over for a list that was sitting on today', () => {
    expect(dayAfterRollover('2026-09-17', '2026-09-17', '2026-09-18')).toBe(
      '2026-09-18',
    );
  });

  it('leaves a day the technician chose exactly where they put it', () => {
    // They were looking at next Tuesday when midnight passed. Next Tuesday is
    // still next Tuesday, and moving them off it would be its own surprise.
    expect(dayAfterRollover('2026-09-22', '2026-09-17', '2026-09-18')).toBe(
      '2026-09-22',
    );
    // And the day they chose that has since become today stays put too.
    expect(dayAfterRollover('2026-09-18', '2026-09-17', '2026-09-18')).toBe(
      '2026-09-18',
    );
  });

  it('changes nothing while the day has not turned over', () => {
    expect(dayAfterRollover('2026-09-17', '2026-09-17', '2026-09-17')).toBe(
      '2026-09-17',
    );
    expect(dayAfterRollover('2026-09-20', '2026-09-17', '2026-09-17')).toBe(
      '2026-09-20',
    );
  });
});

describe('daySwipeHandlers', () => {
  const wired = () => {
    const step = jest.fn();
    return { step, handlers: daySwipeHandlers(step) };
  };

  it('claims the gesture only once it is clearly a sideways swipe', () => {
    const { handlers } = wired();
    expect(handlers.onMoveShouldSetPanResponder({}, { dx: -80, dy: 4 })).toBe(true);
    // The list under this has to keep scrolling.
    expect(handlers.onMoveShouldSetPanResponder({}, { dx: -8, dy: 140 })).toBe(false);
  });

  it('moves a day on release, in the direction the thumb went', () => {
    const { step, handlers } = wired();
    handlers.onPanResponderRelease({}, { dx: -120, dy: 6 });
    expect(step).toHaveBeenCalledWith(1);

    handlers.onPanResponderRelease({}, { dx: 120, dy: -6 });
    expect(step).toHaveBeenLastCalledWith(-1);
  });

  it('leaves the day alone when the gesture was not a swipe', () => {
    const { step, handlers } = wired();
    handlers.onPanResponderRelease({}, { dx: -12, dy: 2 });
    handlers.onPanResponderRelease({}, { dx: -60, dy: 200 });
    expect(step).not.toHaveBeenCalled();
  });
});

describe('swipeIntent', () => {
  it('turns a decisive drag into the next or the previous day', () => {
    expect(swipeIntent(-80, 4)).toBe('next');
    expect(swipeIntent(80, -4)).toBe('prev');
  });

  it('ignores a drag too short to have been meant', () => {
    expect(swipeIntent(-20, 0)).toBeNull();
  });

  // The list under this scrolls with the same thumb: a mostly-vertical drag
  // that wanders sideways must stay a scroll, not become a day change.
  it('ignores a drag that is really a scroll', () => {
    expect(swipeIntent(-60, 120)).toBeNull();
    expect(swipeIntent(60, -200)).toBeNull();
  });
});
