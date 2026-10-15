import { planGpsDefaultOn } from '../../../src/users/gps-default-on-backfill';

/**
 * Track location became on by default on 2026-10-15. Until the day before,
 * the flag was stored but read by nothing, so every "off" on a card is the old
 * default, not a manager's decision — the backfill turns them on once.
 */
describe('planGpsDefaultOn', () => {
  it('turns Track location on for a card that has it off', () => {
    expect(planGpsDefaultOn({ userType: 'regular' }, { gpsTrackingEnabled: false })).toBe(true);
  });

  it('…and for a card that never had the flag', () => {
    expect(planGpsDefaultOn({}, {})).toBe(true);
  });

  it('leaves a card that already tracks alone — a second run changes nothing', () => {
    expect(planGpsDefaultOn({ userType: 'regular' }, { gpsTrackingEnabled: true })).toBe(false);
  });

  it('never turns it on for a subcontractor, by the user record or the old card', () => {
    expect(planGpsDefaultOn({ userType: 'subcontractor' }, { gpsTrackingEnabled: false })).toBe(false);
    expect(planGpsDefaultOn({}, { technicianType: 'subcontractor', gpsTrackingEnabled: false })).toBe(false);
  });

  it('has nothing to do for a person without a card', () => {
    expect(planGpsDefaultOn({ userType: 'regular' }, undefined)).toBe(false);
  });
});
