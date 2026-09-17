import { JobSuperStatus, type Deal } from './types';
import {
  addressLine,
  clientDisplayName,
  clientPhone,
  compareVisitOrder,
  formatClock,
  formatDayHeading,
  formatSlot,
  formatPhone,
  formatStampTime,
  groupJobsByDay,
  groupJobsForDay,
  isClosedJob,
  jobStamps,
  localDateIso,
  navigationUrl,
  shiftDateIso,
  statusLabel,
  statusTone,
  teamSummary,
  techActionState,
} from './lib';

/**
 * The grouping vectors are the web's own
 * (`apps/web/features/tech/lib.test.ts` on `bitcrm-f-tech`), carried over
 * unchanged. That is the point: the phone and the browser have to show the
 * same day, in the same order, or a technician and their dispatcher are
 * looking at two different routes.
 */

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: over.id ?? 'd1',
    dealNumber: over.dealNumber ?? 'A1B2C3',
    contactId: 'c1',
    address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' },
    superStatus: JobSuperStatus.IN_PROGRESS,
    assignedTechIds: ['t1'],
    ...over,
  };
}

const TODAY = '2026-09-16';

describe('dates', () => {
  it('formats the local day as YYYY-MM-DD', () => {
    expect(localDateIso(new Date(2026, 8, 16, 23, 30))).toBe('2026-09-16');
  });

  it('shifts a day across a month boundary', () => {
    expect(shiftDateIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDateIso('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('formats 24h clocks as 12h', () => {
    expect(formatClock('09:00')).toBe('9:00 AM');
    expect(formatClock('12:30')).toBe('12:30 PM');
    expect(formatClock('00:15')).toBe('12:15 AM');
    expect(formatClock('garbage')).toBe('garbage');
  });

  it('formats a slot, an all-day job and a missing time', () => {
    expect(formatSlot('09:00-12:00', false)).toBe('9:00 AM – 12:00 PM');
    expect(formatSlot('09:00-09:00', false)).toBe('9:00 AM');
    expect(formatSlot('09:00-12:00', true)).toBe('All day');
    expect(formatSlot(undefined, false)).toBe('No time');
  });

  it('labels a later day with its weekday', () => {
    expect(formatDayHeading('2026-09-23')).toBe('Wed, Sep 23');
  });
});

describe('groupJobsByDay', () => {
  it('puts still-open earlier jobs first, then today, tomorrow, later days, unscheduled', () => {
    const groups = groupJobsByDay(
      [
        deal({ id: 'later', scheduledDate: '2026-09-23', scheduledTimeSlot: '09:00-10:00' }),
        deal({ id: 'today', scheduledDate: TODAY, scheduledTimeSlot: '09:00-10:00' }),
        deal({ id: 'tomorrow', scheduledDate: '2026-09-17' }),
        deal({ id: 'overdue', scheduledDate: '2026-09-10', superStatus: JobSuperStatus.SUBMITTED }),
        deal({ id: 'nodate' }),
      ],
      TODAY,
      't1',
    );
    expect(groups.map((g) => g.key)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'day:2026-09-23',
      'unscheduled',
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Still open from earlier',
      'Today',
      'Tomorrow',
      'Wed, Sep 23',
      'Not scheduled yet',
    ]);
    expect(groups[1]!.deals.map((d) => d.id)).toEqual(['today']);
  });

  it('always shows Today, even when empty', () => {
    expect(groupJobsByDay([], TODAY)).toEqual([
      { key: 'today', label: 'Today', dateIso: TODAY, deals: [] },
    ]);
  });

  it('drops finished jobs from earlier days but keeps today’s', () => {
    const groups = groupJobsByDay(
      [
        deal({ id: 'old-done', scheduledDate: '2026-09-10', superStatus: JobSuperStatus.DONE }),
        deal({ id: 'old-canceled', scheduledDate: '2026-09-10', superStatus: JobSuperStatus.CANCELED }),
        deal({ id: 'today-done', scheduledDate: TODAY, superStatus: JobSuperStatus.DONE }),
        deal({ id: 'nodate-done', superStatus: JobSuperStatus.DONE }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.key)).toEqual(['today']);
    expect(groups[0]!.deals.map((d) => d.id)).toEqual(['today-done']);
  });

  it('drops finished jobs from future days too — a canceled job is no stop on Tuesday', () => {
    const groups = groupJobsByDay(
      [
        deal({
          id: 'tomorrow-canceled',
          scheduledDate: '2026-09-17',
          superStatus: JobSuperStatus.CANCELED,
        }),
        deal({ id: 'later-done', scheduledDate: '2026-09-23', superStatus: JobSuperStatus.DONE }),
        deal({ id: 'later-open', scheduledDate: '2026-09-23', superStatus: JobSuperStatus.SUBMITTED }),
      ],
      TODAY,
    );

    // Tomorrow held nothing but a canceled job, so it gets no heading at all.
    expect(groups.map((g) => g.key)).toEqual(['today', 'day:2026-09-23']);
    expect(groups[1]!.deals.map((d) => d.id)).toEqual(['later-open']);
  });

  it("orders a day by the technician's route position, then slot start", () => {
    const groups = groupJobsByDay(
      [
        deal({ id: 'b', dealNumber: 'B', scheduledDate: TODAY, scheduledTimeSlot: '08:00-09:00' }),
        deal({ id: 'a', dealNumber: 'A', scheduledDate: TODAY, scheduledTimeSlot: '13:00-14:00', sequences: { t1: 1 } }),
        deal({ id: 'c', dealNumber: 'C', scheduledDate: TODAY, scheduledTimeSlot: '10:00-11:00', sequences: { t1: 2 } }),
        deal({ id: 'd', dealNumber: 'D', scheduledDate: TODAY }),
      ],
      TODAY,
      't1',
    );
    expect(groups[0]!.deals.map((d) => d.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it("ignores another technician's route positions", () => {
    const a = deal({ id: 'a', scheduledTimeSlot: '13:00-14:00', sequences: { other: 1 } });
    const b = deal({ id: 'b', scheduledTimeSlot: '08:00-09:00' });
    expect(compareVisitOrder(a, b, 't1')).toBeGreaterThan(0);
  });

  it('breaks a dead heat on the job number, so the list never reshuffles itself', () => {
    const a = deal({ id: 'a', dealNumber: 'AAA', scheduledTimeSlot: '08:00-09:00' });
    const b = deal({ id: 'b', dealNumber: 'BBB', scheduledTimeSlot: '08:00-09:00' });
    expect(compareVisitOrder(a, b, 't1')).toBeLessThan(0);
    expect(compareVisitOrder(b, a, 't1')).toBeGreaterThan(0);
  });

  it('does not mutate the list it was handed', () => {
    const deals = [
      deal({ id: 'b', dealNumber: 'B', scheduledDate: TODAY, scheduledTimeSlot: '10:00-11:00' }),
      deal({ id: 'a', dealNumber: 'A', scheduledDate: TODAY, scheduledTimeSlot: '08:00-09:00' }),
    ];
    const before = deals.map((d) => d.id);
    groupJobsByDay(deals, TODAY, 't1');
    expect(deals.map((d) => d.id)).toEqual(before);
  });
});

describe('groupJobsForDay', () => {
  const YESTERDAY = '2026-09-15';
  const TOMORROW = '2026-09-17';
  const LATER = '2026-09-23';

  it('is the day list itself when the technician is on today', () => {
    const deals = [
      deal({ id: 'old', scheduledDate: YESTERDAY }),
      deal({ id: 'now', scheduledDate: TODAY }),
      deal({ id: 'none', scheduledDate: undefined }),
    ];
    expect(groupJobsForDay(deals, TODAY, TODAY, 't1')).toEqual(
      groupJobsByDay(deals, TODAY, 't1'),
    );
  });

  it('shows one day, and only that day, once the technician moves off today', () => {
    const groups = groupJobsForDay(
      [
        deal({ id: 'old', scheduledDate: YESTERDAY }),
        deal({ id: 'now', scheduledDate: TODAY }),
        deal({ id: 'then', scheduledDate: LATER }),
        deal({ id: 'none', scheduledDate: undefined }),
      ],
      LATER,
      TODAY,
      't1',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Wed, Sep 23');
    expect(groups[0]!.deals.map((d) => d.id)).toEqual(['then']);
  });

  it('names tomorrow rather than dating it', () => {
    const [group] = groupJobsForDay([], TOMORROW, TODAY, 't1');
    expect(group!.label).toBe('Tomorrow');
    expect(group!.key).toBe('tomorrow');
  });

  it('keeps the day even when nothing is booked on it', () => {
    const groups = groupJobsForDay([deal({ scheduledDate: TODAY })], LATER, TODAY, 't1');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.deals).toEqual([]);
  });

  // A day already past is only ever opened deliberately, and "what did I do on
  // Tuesday" is the question that takes a technician there — the finished work
  // is the answer, so it is not dropped the way today's list drops it.
  it('keeps a past day’s finished work, which the day list hides', () => {
    const done = deal({
      id: 'done',
      scheduledDate: YESTERDAY,
      superStatus: JobSuperStatus.DONE,
    });
    expect(groupJobsForDay([done], YESTERDAY, TODAY, 't1')[0]!.deals).toEqual([done]);
    expect(groupJobsByDay([done], TODAY, 't1').flatMap((g) => g.deals)).toEqual([]);
  });

  it('puts a chosen day in visit order, like every other day', () => {
    const groups = groupJobsForDay(
      [
        deal({ id: 'b', dealNumber: 'B', scheduledDate: LATER, scheduledTimeSlot: '14:00-16:00' }),
        deal({ id: 'a', dealNumber: 'A', scheduledDate: LATER, scheduledTimeSlot: '09:00-11:00' }),
      ],
      LATER,
      TODAY,
      't1',
    );
    expect(groups[0]!.deals.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('reads a full timestamp as the day it falls on', () => {
    const groups = groupJobsForDay(
      [deal({ id: 'then', scheduledDate: `${LATER}T13:00:00.000Z` })],
      LATER,
      TODAY,
      't1',
    );
    expect(groups[0]!.deals.map((d) => d.id)).toEqual(['then']);
  });
});

describe('address', () => {
  it('renders one line, skipping empty parts', () => {
    expect(
      addressLine({ street: '1 Main St', unit: 'Apt 2', city: 'Hartford', state: 'CT', zip: '06103' }),
    ).toBe('1 Main St, Apt 2, Hartford, CT 06103');
    expect(addressLine({ street: '', city: '', state: '', zip: '' })).toBe('');
    expect(addressLine(undefined)).toBe('');
  });

  it('navigates by coordinates when geocoded, by text otherwise', () => {
    expect(
      navigationUrl({ street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103', lat: 41.76, lng: -72.67 }),
    ).toBe('https://www.google.com/maps/dir/?api=1&destination=41.76%2C-72.67');
    expect(
      navigationUrl({ street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103' }),
    ).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St%2C%20Hartford%2C%20CT%2006103',
    );
    expect(navigationUrl({ street: '', city: '', state: '', zip: '' })).toBeNull();
    expect(navigationUrl(undefined)).toBeNull();
  });
});

describe('techActionState', () => {
  it('offers the whole flow on a fresh Submitted job', () => {
    expect(techActionState({ superStatus: JobSuperStatus.SUBMITTED })).toEqual({
      canConfirm: true,
      canNotify: true,
      canArrive: true,
      canStart: true,
      canFinish: false,
      canReschedule: true,
    });
  });

  it('hides confirm and arrived once they have happened, and offers Done while in progress', () => {
    expect(
      techActionState({
        superStatus: JobSuperStatus.IN_PROGRESS,
        techConfirmedAt: 'x',
        arrivedAt: 'y',
      }),
    ).toEqual({
      canConfirm: false,
      canNotify: true,
      canArrive: false,
      canStart: false,
      canFinish: true,
      canReschedule: true,
    });
  });

  it('offers nothing on a closed job', () => {
    expect(techActionState({ superStatus: JobSuperStatus.DONE })).toEqual({
      canConfirm: false,
      canNotify: false,
      canArrive: false,
      canStart: false,
      canFinish: false,
      canReschedule: false,
    });
  });

  it('counts awaiting-approval and canceled as closed too', () => {
    expect(isClosedJob({ superStatus: JobSuperStatus.DONE_PENDING_APPROVAL })).toBe(true);
    expect(isClosedJob({ superStatus: JobSuperStatus.CANCELED })).toBe(true);
    expect(isClosedJob({ superStatus: JobSuperStatus.PENDING })).toBe(false);
  });
});

describe('status chip', () => {
  it('gives every status a word, not just a colour', () => {
    expect(statusLabel(JobSuperStatus.IN_PROGRESS)).toBe('In progress');
    expect(statusLabel(JobSuperStatus.DONE_PENDING_APPROVAL)).toBe('Awaiting approval');
  });

  it('still renders a status the app has never heard of', () => {
    expect(statusLabel('some_new_status')).toBe('some_new_status');
    expect(statusTone('some_new_status')).toBe('neutral');
  });

  it('separates in-progress from done and canceled by tone', () => {
    expect(statusTone(JobSuperStatus.IN_PROGRESS)).toBe('active');
    expect(statusTone(JobSuperStatus.DONE)).toBe('done');
    expect(statusTone(JobSuperStatus.CANCELED)).toBe('canceled');
    expect(statusTone(JobSuperStatus.PENDING)).toBe('warning');
  });
});

describe('client name and stamps', () => {
  it("uses the job's own client-name override when it carries one", () => {
    expect(clientDisplayName({ clientName: { firstName: 'Ada', lastName: 'Byron' } })).toBe(
      'Ada Byron',
    );
    expect(clientDisplayName({})).toBe('');
  });

  it('stamps a wall-clock time dispatch can read back over the phone', () => {
    expect(formatStampTime('2026-09-16T13:04:00.000Z')).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  it('shows nothing rather than "Invalid Date" for a missing or broken stamp', () => {
    expect(formatStampTime(undefined)).toBeNull();
    expect(formatStampTime('not a date')).toBeNull();
  });
});

describe('jobStamps', () => {
  it('walks sent → seen → arrived, marking only what has happened', () => {
    const stamps = jobStamps({
      sentToTechAt: '2026-09-16T12:00:00.000Z',
      seenByTechAt: '2026-09-16T13:04:00.000Z',
    });
    expect(stamps.map((s) => [s.key, s.done])).toEqual([
      ['sent', true],
      ['seen', true],
      ['arrived', false],
    ]);
    expect(stamps[2]!.time).toBeNull();
  });

  it('always offers all three steps, so the gap is visible', () => {
    expect(jobStamps({}).map((s) => s.label)).toEqual(['Sent', 'Seen', 'Arrived']);
    expect(jobStamps({}).every((s) => !s.done)).toBe(true);
  });

  it('counts a step whose timestamp it cannot read — it still happened', () => {
    const [sent] = jobStamps({ sentToTechAt: 'nonsense' });
    expect(sent).toEqual({ key: 'sent', label: 'Sent', time: null, done: true });
  });

  /*
   * The regression this trio locks down. Every one of these passed before the
   * fix while showing a technician a time that meant something else, which is
   * the only kind of bug a stamp can have: it is never obviously wrong on
   * screen, it is just a different number from the one dispatch is reading.
   */
  it('shows when dispatch pressed Send, not when the job was written down', () => {
    // A job booked on the Monday for the Thursday, and sent on the Thursday.
    const [sent] = jobStamps(
      deal({
        createdAt: '2026-09-14T09:12:00.000Z',
        sentToTechAt: '2026-09-17T07:40:00.000Z',
      }),
    );
    expect(sent!.time).toBe(formatStampTime('2026-09-17T07:40:00.000Z'));
    expect(sent!.time).not.toBe(formatStampTime('2026-09-14T09:12:00.000Z'));
  });

  it('leaves Sent blank on a job dispatch has written but not sent', () => {
    const [sent] = jobStamps(deal({ createdAt: '2026-09-14T09:12:00.000Z' }));
    expect(sent).toEqual({ key: 'sent', label: 'Sent', time: null, done: false });
  });

  it('does not report a confirmed job as seen, nor a seen job as unseen', () => {
    // "Confirm receipt" is a button a technician presses; "seen" is the app
    // reporting an open. Separate stamps, and each answers only for itself.
    const confirmedNotOpened = jobStamps(
      deal({ techConfirmedAt: '2026-09-17T08:00:00.000Z' }),
    );
    expect(confirmedNotOpened[1]).toEqual({
      key: 'seen',
      label: 'Seen',
      time: null,
      done: false,
    });

    const openedNotConfirmed = jobStamps(deal({ seenByTechAt: '2026-09-17T08:05:00.000Z' }));
    expect(openedNotConfirmed[1]!.done).toBe(true);
  });
});

/**
 * The Client block on the job card (§1.4). The number is shown for reading and
 * writing down; dialling still goes through the masked bridge.
 */
describe('the client’s phone', () => {
  it('groups a NANP number the way a technician reads it aloud', () => {
    expect(formatPhone('+18605551234')).toBe('(860) 555-1234');
    expect(formatPhone('8605551234')).toBe('(860) 555-1234');
    expect(formatPhone('860-555-1234')).toBe('(860) 555-1234');
  });

  it('hands anything else back exactly as it was stored', () => {
    // A guess at grouping an international number is worse than none, and a
    // number a technician cannot dial back is worse than either.
    expect(formatPhone('+442071234567')).toBe('+442071234567');
    expect(formatPhone('  x1234  ')).toBe('x1234');
  });

  it('shows the first number and says how many more there are', () => {
    expect(clientPhone({ phones: ['+18605551234', '+18605559999'] })).toEqual({
      display: '(860) 555-1234',
      hidden: 0,
      extra: 1,
    });
  });

  it('tells "none on file" apart from "you may not see them"', () => {
    // A technician's role carries `contacts.view_numbers`, so the masked case
    // should not arise — but a dash where a withheld number goes reads as a
    // client who never gave one, and that is a call nobody makes.
    expect(clientPhone({ phones: [] })).toEqual({
      display: null,
      hidden: 0,
      extra: 0,
    });
    expect(clientPhone({ phones: [], phoneCount: 2 })).toEqual({
      display: null,
      hidden: 2,
      extra: 0,
    });
    expect(clientPhone(undefined).display).toBeNull();
  });
});

/**
 * The Team block. The phone cannot turn technician ids into names — there is
 * no directory endpoint in the app — so it answers the question the roster can
 * answer: am I on my own at this door?
 */
describe('teamSummary', () => {
  it('says when the job is the technician’s alone', () => {
    expect(teamSummary(deal({ assignedTechIds: ['t1'] }), 't1')).toBe(
      'Just you on this job.',
    );
  });

  it('counts the others without pretending to name them', () => {
    expect(teamSummary(deal({ assignedTechIds: ['t1', 't2'] }), 't1')).toBe(
      'You and one other technician.',
    );
    expect(teamSummary(deal({ assignedTechIds: ['t1', 't2', 't3'] }), 't1')).toBe(
      'You and 2 other technicians.',
    );
  });

  it('is plain about a job somebody else is assigned to', () => {
    // Reachable: a job opened from a push after dispatch reassigned it.
    expect(teamSummary(deal({ assignedTechIds: ['t9'] }), 't1')).toBe(
      'One technician is assigned — not you.',
    );
    expect(teamSummary(deal({ assignedTechIds: ['t8', 't9'] }), 't1')).toBe(
      '2 technicians are assigned — not you.',
    );
  });

  it('does not claim a roster for an unassigned job', () => {
    expect(teamSummary(deal({ assignedTechIds: [] }), 't1')).toBe(
      'Nobody is assigned to this job yet.',
    );
    expect(teamSummary({}, 't1')).toBe('Nobody is assigned to this job yet.');
  });
});
