import { DealStatus, JobSuperStatus, clientConfirmScheduleKey, isClientConfirmationCurrent } from '@bitcrm/types';
import { clientConfirmState, visitEndWall } from 'src/deals/client-confirm/client-confirm.rules';
import { createMockDeal } from '../mocks';

const NY = 'America/New_York';
// 2026-04-20 10:30 in New York (EDT, UTC-4).
const DURING = new Date('2026-04-20T14:30:00.000Z');

describe('client confirm rules (B12, Workiz {{confirm_link}})', () => {
  describe('the visit a confirmation is for', () => {
    it('is the start day and the slot, or all-day, or nothing for an unscheduled job', () => {
      expect(clientConfirmScheduleKey(createMockDeal())).toBe('2026-04-20 09:00-12:00');
      expect(clientConfirmScheduleKey(createMockDeal({ allDay: true, scheduledTimeSlot: undefined }))).toBe(
        '2026-04-20 all-day',
      );
      expect(clientConfirmScheduleKey(createMockDeal({ scheduledDate: undefined }))).toBe('');
    });

    it('stops speaking for the job once it is rescheduled (day or time)', () => {
      const confirmed = createMockDeal({
        clientConfirmedAt: '2026-04-19T15:00:00.000Z',
        clientConfirmedFor: '2026-04-20 09:00-12:00',
      });
      expect(isClientConfirmationCurrent(confirmed)).toBe(true);
      expect(isClientConfirmationCurrent({ ...confirmed, scheduledDate: '2026-04-21' })).toBe(false);
      expect(isClientConfirmationCurrent({ ...confirmed, scheduledTimeSlot: '13:00-15:00' })).toBe(false);
      expect(isClientConfirmationCurrent(createMockDeal())).toBe(false);
      // Confirmed while unscheduled, still unscheduled.
      expect(
        isClientConfirmationCurrent(
          createMockDeal({ scheduledDate: undefined, clientConfirmedAt: '2026-04-19T15:00:00.000Z' }),
        ),
      ).toBe(true);
    });
  });

  describe('visitEndWall — the end of the visit on the job’s own clock', () => {
    it('is the end day and the slot’s end', () => {
      expect(visitEndWall(createMockDeal())).toBe('2026-04-20T12:00');
      expect(visitEndWall(createMockDeal({ scheduledEndDate: '2026-04-22' }))).toBe('2026-04-22T12:00');
    });

    it('is the end of the day for an all-day visit or one without a time', () => {
      expect(visitEndWall(createMockDeal({ allDay: true, scheduledTimeSlot: undefined }))).toBe('2026-04-20T23:59');
      expect(visitEndWall(createMockDeal({ scheduledTimeSlot: undefined }))).toBe('2026-04-20T23:59');
    });

    it('runs past midnight when a same-day slot ends before it starts', () => {
      expect(visitEndWall(createMockDeal({ scheduledTimeSlot: '22:00-01:00' }))).toBe('2026-04-21T01:00');
    });

    it('has no end without a date', () => {
      expect(visitEndWall(createMockDeal({ scheduledDate: undefined }))).toBeUndefined();
    });
  });

  describe('clientConfirmState', () => {
    it('is open for a live job whose visit is still ahead or under way', () => {
      expect(clientConfirmState(createMockDeal(), DURING, NY)).toBe('open');
      expect(clientConfirmState(createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS }), DURING, NY)).toBe('open');
      expect(clientConfirmState(createMockDeal({ superStatus: JobSuperStatus.PENDING }), DURING, NY)).toBe('open');
    });

    it('is open for a job that has no date yet (Workiz flags the job, not a time)', () => {
      expect(clientConfirmState(createMockDeal({ scheduledDate: undefined }), DURING, NY)).toBe('open');
    });

    it('is closed once the job is done, canceled, awaiting approval or deleted', () => {
      for (const superStatus of [
        JobSuperStatus.DONE,
        JobSuperStatus.CANCELED,
        JobSuperStatus.DONE_PENDING_APPROVAL,
      ]) {
        expect(clientConfirmState(createMockDeal({ superStatus }), DURING, NY)).toBe('closed');
      }
      expect(clientConfirmState(createMockDeal({ status: DealStatus.DELETED }), DURING, NY)).toBe('closed');
    });

    it('is expired once the visit is over on the job’s clock — and not before', () => {
      // 12:01 New York = 16:01Z: one minute after the 09:00-12:00 slot.
      expect(clientConfirmState(createMockDeal(), new Date('2026-04-20T16:01:00.000Z'), NY)).toBe('expired');
      // 11:59 New York.
      expect(clientConfirmState(createMockDeal(), new Date('2026-04-20T15:59:00.000Z'), NY)).toBe('open');
      // The same instant is still morning in Los Angeles.
      expect(
        clientConfirmState(createMockDeal(), new Date('2026-04-20T16:01:00.000Z'), 'America/Los_Angeles'),
      ).toBe('open');
    });

    it('is confirmed when the client already confirmed this visit', () => {
      const deal = createMockDeal({
        clientConfirmedAt: '2026-04-19T15:00:00.000Z',
        clientConfirmedFor: '2026-04-20 09:00-12:00',
      });
      expect(clientConfirmState(deal, DURING, NY)).toBe('confirmed');
      // Moved since: the new time is the client's to confirm.
      expect(clientConfirmState({ ...deal, scheduledDate: '2026-04-21' }, DURING, NY)).toBe('open');
      // A closed job says so, whatever was confirmed before.
      expect(clientConfirmState({ ...deal, superStatus: JobSuperStatus.CANCELED }, DURING, NY)).toBe('closed');
      // After the visit the client still sees their confirmation, not "too late".
      expect(clientConfirmState(deal, new Date('2026-04-21T16:00:00.000Z'), NY)).toBe('confirmed');
    });
  });
});
