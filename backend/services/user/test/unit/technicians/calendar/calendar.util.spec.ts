import { CalendarEventType, type CalendarEvent } from '@bitcrm/types';
import {
  validateEventShape,
  eventOverlapsDate,
  eventsForDate,
} from '../../../../src/technicians/calendar/calendar.util';

type Draft = Parameters<typeof validateEventShape>[0];

const base: Draft = {
  type: CalendarEventType.LUNCH,
  title: 'Lunch',
  startDate: '2026-07-24',
  endDate: '2026-07-24',
  allDay: false,
  timeSlot: '12:00-13:00',
};

function event(overrides?: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt-1',
    technicianId: 'tech-1',
    type: CalendarEventType.TIME_OFF,
    title: 'Vacation',
    startDate: '2026-07-24',
    endDate: '2026-07-26',
    allDay: true,
    createdBy: 'mgr-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('validateEventShape', () => {
  it('accepts a single-day timed event with a slot', () => {
    expect(validateEventShape(base)).toBeNull();
  });

  it('accepts a multi-day all-day event with no slot', () => {
    expect(
      validateEventShape({
        ...base,
        type: CalendarEventType.TIME_OFF,
        allDay: true,
        endDate: '2026-07-27',
        timeSlot: undefined,
      }),
    ).toBeNull();
  });

  it('rejects an all-day event that also carries a slot', () => {
    expect(validateEventShape({ ...base, allDay: true, timeSlot: '12:00-13:00' })).toMatch(
      /all-day/i,
    );
  });

  it('rejects a timed event with no slot', () => {
    expect(validateEventShape({ ...base, allDay: false, timeSlot: undefined })).toMatch(
      /timeSlot/i,
    );
  });

  it('rejects a timed event spanning more than one day', () => {
    expect(
      validateEventShape({ ...base, allDay: false, endDate: '2026-07-25' }),
    ).toMatch(/single day/i);
  });

  it('rejects endDate before startDate', () => {
    expect(
      validateEventShape({ ...base, allDay: true, timeSlot: undefined, endDate: '2026-07-23' }),
    ).toMatch(/before/i);
  });

  it('rejects a malformed time slot', () => {
    expect(validateEventShape({ ...base, timeSlot: '9-10' })).toMatch(/HH:MM/i);
  });

  it('rejects a span longer than the 60-day cap', () => {
    expect(
      validateEventShape({
        ...base,
        allDay: true,
        timeSlot: undefined,
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      }),
    ).toMatch(/60/);
  });
});

describe('eventOverlapsDate', () => {
  it('is true across the inclusive span', () => {
    const e = event({ startDate: '2026-07-24', endDate: '2026-07-26' });
    expect(eventOverlapsDate(e, '2026-07-24')).toBe(true);
    expect(eventOverlapsDate(e, '2026-07-25')).toBe(true);
    expect(eventOverlapsDate(e, '2026-07-26')).toBe(true);
  });

  it('is false outside the span', () => {
    const e = event({ startDate: '2026-07-24', endDate: '2026-07-26' });
    expect(eventOverlapsDate(e, '2026-07-23')).toBe(false);
    expect(eventOverlapsDate(e, '2026-07-27')).toBe(false);
  });
});

describe('eventsForDate', () => {
  it('keeps only events overlapping the given date', () => {
    const a = event({ id: 'a', startDate: '2026-07-24', endDate: '2026-07-24' });
    const b = event({ id: 'b', startDate: '2026-07-20', endDate: '2026-07-22' });
    expect(eventsForDate([a, b], '2026-07-24').map((e) => e.id)).toEqual(['a']);
  });
});
