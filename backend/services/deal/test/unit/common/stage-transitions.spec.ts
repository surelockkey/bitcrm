import { DealStage } from '@bitcrm/types';
import { canTransition, getAllowedNextStages } from 'src/common/constants/stage-transitions';

describe('Stage Transitions', () => {
  describe('canTransition', () => {
    describe('wildcard *->* (super admin / admin)', () => {
      const transitions = ['*->*'];

      it('should allow any non-terminal transition', () => {
        expect(canTransition(transitions, DealStage.NEW_LEAD, DealStage.ASSIGNED)).toBe(true);
        expect(canTransition(transitions, DealStage.WORK_IN_PROGRESS, DealStage.COMPLETED)).toBe(true);
        expect(canTransition(transitions, DealStage.NEW_LEAD, DealStage.CANCELED)).toBe(true);
      });

      it('should not allow transition from terminal stages', () => {
        expect(canTransition(transitions, DealStage.COMPLETED, DealStage.NEW_LEAD)).toBe(false);
        expect(canTransition(transitions, DealStage.CANCELED, DealStage.NEW_LEAD)).toBe(false);
      });

      it('should not allow transition to same stage', () => {
        expect(canTransition(transitions, DealStage.NEW_LEAD, DealStage.NEW_LEAD)).toBe(false);
      });
    });

    describe('dispatcher transitions', () => {
      const transitions = [
        'new_lead->estimate_sent',
        'estimate_sent->approved',
        'approved->assigned',
        'new_lead->assigned',
        '*->canceled',
        '*->follow_up',
        '*->on_hold',
      ];

      it('should allow defined forward transitions', () => {
        expect(canTransition(transitions, DealStage.NEW_LEAD, DealStage.ESTIMATE_SENT)).toBe(true);
        expect(canTransition(transitions, DealStage.ESTIMATE_SENT, DealStage.APPROVED)).toBe(true);
        expect(canTransition(transitions, DealStage.APPROVED, DealStage.ASSIGNED)).toBe(true);
        expect(canTransition(transitions, DealStage.NEW_LEAD, DealStage.ASSIGNED)).toBe(true);
      });

      it('should allow wildcard to-stage transitions', () => {
        expect(canTransition(transitions, DealStage.NEW_LEAD, DealStage.CANCELED)).toBe(true);
        expect(canTransition(transitions, DealStage.ASSIGNED, DealStage.CANCELED)).toBe(true);
        expect(canTransition(transitions, DealStage.WORK_IN_PROGRESS, DealStage.FOLLOW_UP)).toBe(true);
        expect(canTransition(transitions, DealStage.EN_ROUTE, DealStage.ON_HOLD)).toBe(true);
      });

      it('should not allow undefined transitions', () => {
        expect(canTransition(transitions, DealStage.NEW_LEAD, DealStage.COMPLETED)).toBe(false);
        expect(canTransition(transitions, DealStage.ASSIGNED, DealStage.EN_ROUTE)).toBe(false);
      });

      it('should not allow transition from terminal stages', () => {
        expect(canTransition(transitions, DealStage.CANCELED, DealStage.NEW_LEAD)).toBe(false);
      });
    });

    describe('technician transitions', () => {
      const transitions = [
        'assigned->en_route',
        'en_route->on_site',
        'on_site->work_in_progress',
        'work_in_progress->pending_payment',
        'work_in_progress->pending_parts',
      ];

      it('should allow linear progression', () => {
        expect(canTransition(transitions, DealStage.ASSIGNED, DealStage.EN_ROUTE)).toBe(true);
        expect(canTransition(transitions, DealStage.EN_ROUTE, DealStage.ON_SITE)).toBe(true);
        expect(canTransition(transitions, DealStage.ON_SITE, DealStage.WORK_IN_PROGRESS)).toBe(true);
        expect(canTransition(transitions, DealStage.WORK_IN_PROGRESS, DealStage.PENDING_PAYMENT)).toBe(true);
      });

      it('should allow branching to pending parts', () => {
        expect(canTransition(transitions, DealStage.WORK_IN_PROGRESS, DealStage.PENDING_PARTS)).toBe(true);
      });

      it('should not allow skipping stages', () => {
        expect(canTransition(transitions, DealStage.ASSIGNED, DealStage.ON_SITE)).toBe(false);
        expect(canTransition(transitions, DealStage.EN_ROUTE, DealStage.WORK_IN_PROGRESS)).toBe(false);
      });

      it('should not allow going to completed or canceled', () => {
        expect(canTransition(transitions, DealStage.WORK_IN_PROGRESS, DealStage.COMPLETED)).toBe(false);
        expect(canTransition(transitions, DealStage.WORK_IN_PROGRESS, DealStage.CANCELED)).toBe(false);
      });

      it('should not allow backward transitions', () => {
        expect(canTransition(transitions, DealStage.ON_SITE, DealStage.EN_ROUTE)).toBe(false);
      });
    });

    describe('empty transitions (read-only)', () => {
      const transitions: string[] = [];

      it('should not allow any transition', () => {
        expect(canTransition(transitions, DealStage.NEW_LEAD, DealStage.ASSIGNED)).toBe(false);
        expect(canTransition(transitions, DealStage.ASSIGNED, DealStage.CANCELED)).toBe(false);
      });
    });
  });

  describe('getAllowedNextStages', () => {
    it('should return all stages for wildcard', () => {
      const result = getAllowedNextStages(['*->*'], DealStage.NEW_LEAD);
      expect(result).toContain(DealStage.ASSIGNED);
      expect(result).toContain(DealStage.COMPLETED);
      expect(result).toContain(DealStage.CANCELED);
      expect(result).not.toContain(DealStage.NEW_LEAD);
    });

    it('should return empty for terminal stages', () => {
      expect(getAllowedNextStages(['*->*'], DealStage.COMPLETED)).toEqual([]);
      expect(getAllowedNextStages(['*->*'], DealStage.CANCELED)).toEqual([]);
    });

    it('should return only allowed stages for technician', () => {
      const transitions = [
        'assigned->en_route',
        'en_route->on_site',
      ];
      const result = getAllowedNextStages(transitions, DealStage.ASSIGNED);
      expect(result).toEqual([DealStage.EN_ROUTE]);
    });
  });
});
