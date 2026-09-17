import {
  SLOT_CHOICES,
  buildReschedule,
  describeMove,
  describeRefusal,
  minutesOfDay,
  parseSlot,
  refuseReason,
  slotOptions,
} from './reschedule';

const TODAY = '2026-09-17';
const TOMORROW = '2026-09-18';
const YESTERDAY = '2026-09-16';
/** 09:30. */
const HALF_NINE = 9 * 60 + 30;

describe('parsing a slot', () => {
  it('reads HH:MM-HH:MM as minutes since midnight', () => {
    expect(parseSlot('10:00-12:00')).toEqual({ start: 600, end: 720 });
  });

  it('refuses anything that is not that shape', () => {
    // The server rejects these too (`UpdateDealDto:27`), and a 400 from a
    // queued row is a permanent failure — better to never queue it.
    expect(parseSlot('10:00')).toBeNull();
    expect(parseSlot('1000-1200')).toBeNull();
    expect(parseSlot(undefined)).toBeNull();
    expect(parseSlot('')).toBeNull();
  });
});

describe('minutesOfDay', () => {
  it('counts from the device’s own midnight', () => {
    expect(minutesOfDay(new Date(2026, 8, 17, 9, 30))).toBe(HALF_NINE);
    expect(minutesOfDay(new Date(2026, 8, 17, 0, 0))).toBe(0);
  });
});

describe('slotOptions', () => {
  it('offers the standard windows, in order, for a day still to come', () => {
    const options = slotOptions(TOMORROW, TODAY, HALF_NINE);
    expect(options.map((o) => o.slot)).toEqual([...SLOT_CHOICES]);
    expect(options.every((o) => !o.past)).toBe(true);
  });

  it('labels a window the way the card does', () => {
    const [first] = slotOptions(TOMORROW, TODAY, HALF_NINE);
    expect(first!.label).toBe('8:00 AM – 10:00 AM');
  });

  it('marks the windows that have already ended today', () => {
    const options = slotOptions(TODAY, TODAY, HALF_NINE);
    const past = options.filter((o) => o.past).map((o) => o.slot);
    // 08:00-10:00 has not ended at 09:30 — a technician can still book the
    // window they are standing in.
    expect(past).toEqual([]);

    const afternoon = slotOptions(TODAY, TODAY, 13 * 60).filter((o) => o.past);
    expect(afternoon.map((o) => o.slot)).toEqual(['08:00-10:00', '10:00-12:00']);
  });

  it('marks every window of a day already gone', () => {
    expect(slotOptions(YESTERDAY, TODAY, HALF_NINE).every((o) => o.past)).toBe(true);
  });

  // A job dispatch booked for an odd window must still be movable to another
  // day at the same time; dropping it would retime a visit nobody retimed.
  it('keeps the job’s own window even when it is not a standard one', () => {
    const options = slotOptions(TOMORROW, TODAY, HALF_NINE, '09:30-11:30');
    const own = options.find((o) => o.slot === '09:30-11:30');
    expect(own).toBeDefined();
    expect(own!.current).toBe(true);
    // In order, not appended at the end.
    expect(options.map((o) => o.slot)).toEqual([
      '08:00-10:00',
      '09:30-11:30',
      '10:00-12:00',
      '12:00-14:00',
      '14:00-16:00',
      '16:00-18:00',
      '18:00-20:00',
    ]);
  });

  it('does not list the current window twice when it is a standard one', () => {
    const options = slotOptions(TOMORROW, TODAY, HALF_NINE, '10:00-12:00');
    expect(options.filter((o) => o.slot === '10:00-12:00')).toHaveLength(1);
    expect(options.find((o) => o.slot === '10:00-12:00')!.current).toBe(true);
  });

  it('ignores an unparseable current slot rather than offering it', () => {
    const options = slotOptions(TOMORROW, TODAY, HALF_NINE, 'whenever');
    expect(options.map((o) => o.slot)).toEqual([...SLOT_CHOICES]);
  });
});

describe('refuseReason — the rule that a visit never moves backwards', () => {
  it('lets a real move through', () => {
    expect(
      refuseReason(
        { scheduledDate: TOMORROW, scheduledTimeSlot: '10:00-12:00', allDay: false },
        TODAY,
        HALF_NINE,
      ),
    ).toBeNull();
  });

  it('refuses a day that has gone', () => {
    expect(
      refuseReason(
        { scheduledDate: YESTERDAY, scheduledTimeSlot: '10:00-12:00' },
        TODAY,
        HALF_NINE,
      ),
    ).toBe('past_day');
  });

  it('refuses a window that has already ended today', () => {
    expect(
      refuseReason(
        { scheduledDate: TODAY, scheduledTimeSlot: '08:00-10:00' },
        TODAY,
        13 * 60,
      ),
    ).toBe('past_slot');
  });

  it('allows the window the technician is standing in', () => {
    expect(
      refuseReason({ scheduledDate: TODAY, scheduledTimeSlot: '08:00-10:00' }, TODAY, HALF_NINE),
    ).toBeNull();
  });

  it('refuses a move with no time at all', () => {
    expect(refuseReason({ scheduledDate: TOMORROW }, TODAY, HALF_NINE)).toBe('no_time');
    expect(
      refuseReason({ scheduledDate: TOMORROW, scheduledTimeSlot: 'noon' }, TODAY, HALF_NINE),
    ).toBe('no_time');
  });

  // An all-day job has no window to have ended, but the day still has to be
  // one that has not.
  it('takes all day on today, and not on yesterday', () => {
    expect(refuseReason({ scheduledDate: TODAY, allDay: true }, TODAY, 23 * 60)).toBeNull();
    expect(refuseReason({ scheduledDate: YESTERDAY, allDay: true }, TODAY, 60)).toBe('past_day');
  });

  it('has words for every refusal', () => {
    for (const refusal of ['past_day', 'past_slot', 'no_time'] as const) {
      expect(describeRefusal(refusal).length).toBeGreaterThan(10);
    }
  });
});

describe('what goes on the wire', () => {
  it('states allDay false beside a window', () => {
    expect(buildReschedule(TOMORROW, '10:00-12:00', false)).toEqual({
      scheduledDate: TOMORROW,
      scheduledTimeSlot: '10:00-12:00',
      allDay: false,
    });
  });

  // `PUT /deals/:id` writes only the fields it is given, so a job booked
  // all-day and moved into a window would go on reading "All day".
  it('sends no window at all for an all-day move', () => {
    expect(buildReschedule(TOMORROW, '10:00-12:00', true)).toEqual({
      scheduledDate: TOMORROW,
      allDay: true,
    });
  });

  it('spells the destination out for the button', () => {
    expect(
      describeMove({ scheduledDate: TOMORROW, scheduledTimeSlot: '10:00-12:00' }),
    ).toBe('Fri, Sep 18 · 10:00 AM – 12:00 PM');
    expect(describeMove({ scheduledDate: TOMORROW, allDay: true })).toBe(
      'Fri, Sep 18 · All day',
    );
  });
});
