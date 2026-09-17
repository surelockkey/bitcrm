import { JobSuperStatus, type Deal } from './types';
import {
  addressLine,
  clientDisplayName,
  compareVisitOrder,
  formatClock,
  formatDayHeading,
  formatSlot,
  formatStampTime,
  groupJobsByDay,
  isClosedJob,
  jobStamps,
  localDateIso,
  navigationUrl,
  shiftDateIso,
  statusLabel,
  statusTone,
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
    });
  });

  it('offers nothing on a closed job', () => {
    expect(techActionState({ superStatus: JobSuperStatus.DONE })).toEqual({
      canConfirm: false,
      canNotify: false,
      canArrive: false,
      canStart: false,
      canFinish: false,
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
