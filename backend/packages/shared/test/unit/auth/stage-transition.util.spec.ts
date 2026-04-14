import { canTransitionStage } from '../../../src/auth/stage-transition.util';

describe('canTransitionStage', () => {
  describe('exact match', () => {
    it('should return true for an exact match', () => {
      expect(canTransitionStage('lead', 'qualified', ['lead->qualified'])).toBe(
        true,
      );
    });

    it('should return false when no exact match exists', () => {
      expect(canTransitionStage('lead', 'proposal', ['lead->qualified'])).toBe(
        false,
      );
    });
  });

  describe('wildcard from (*->to)', () => {
    it('should match any "from" stage when wildcard is used', () => {
      expect(
        canTransitionStage('anything', 'canceled', ['*->canceled']),
      ).toBe(true);
    });

    it('should not match when "to" stage differs', () => {
      expect(
        canTransitionStage('anything', 'completed', ['*->canceled']),
      ).toBe(false);
    });
  });

  describe('wildcard to (from->*)', () => {
    it('should match any "to" stage when wildcard is used', () => {
      expect(canTransitionStage('lead', 'anything', ['lead->*'])).toBe(true);
    });

    it('should not match when "from" stage differs', () => {
      expect(canTransitionStage('qualified', 'anything', ['lead->*'])).toBe(
        false,
      );
    });
  });

  describe('full wildcard (*->*)', () => {
    it('should always return true', () => {
      expect(canTransitionStage('any', 'thing', ['*->*'])).toBe(true);
      expect(canTransitionStage('lead', 'canceled', ['*->*'])).toBe(true);
      expect(canTransitionStage('foo', 'bar', ['*->*'])).toBe(true);
    });
  });

  describe('empty rules', () => {
    it('should always return false when rules array is empty', () => {
      expect(canTransitionStage('lead', 'qualified', [])).toBe(false);
      expect(canTransitionStage('any', 'thing', [])).toBe(false);
    });
  });

  describe('multiple rules', () => {
    const rules = ['lead->qualified', 'qualified->proposal', '*->canceled'];

    it('should match first exact rule', () => {
      expect(canTransitionStage('lead', 'qualified', rules)).toBe(true);
    });

    it('should match second exact rule', () => {
      expect(canTransitionStage('qualified', 'proposal', rules)).toBe(true);
    });

    it('should match wildcard rule in the list', () => {
      expect(canTransitionStage('proposal', 'canceled', rules)).toBe(true);
    });

    it('should return false when no rule matches', () => {
      expect(canTransitionStage('lead', 'proposal', rules)).toBe(false);
    });

    it('should return false for reverse of an exact rule', () => {
      expect(canTransitionStage('qualified', 'lead', rules)).toBe(false);
    });
  });
});
