import { planUserTypeBackfill } from '../../../src/users/user-type-backfill';

/**
 * `backfill:user-type` — after the deploy that moves Workiz's "User type" onto
 * the user record, and after every Workiz users import/patch: every
 * subcontractor's sign-in goes off, the card's copy agrees with the user, and
 * a type set on the card before (the old technician form) moves to the user.
 */
describe('planUserTypeBackfill', () => {
  it('a subcontractor on the user record: sign-in off, card already agrees', () => {
    expect(
      planUserTypeBackfill(
        { id: 'u-1', userType: 'subcontractor' },
        { technicianType: 'subcontractor', gpsTrackingEnabled: false },
      ),
    ).toEqual({ userId: 'u-1', type: 'subcontractor', disableSignIn: true });
  });

  it('the card still says User: it is brought in step, and location tracking stops', () => {
    expect(
      planUserTypeBackfill(
        { id: 'u-1', userType: 'subcontractor' },
        { gpsTrackingEnabled: true },
      ),
    ).toEqual({
      userId: 'u-1',
      type: 'subcontractor',
      card: { technicianType: 'subcontractor', gpsTrackingEnabled: false },
      disableSignIn: true,
    });
  });

  it('a type set only on the card (the old form) moves onto the user', () => {
    expect(
      planUserTypeBackfill({ id: 'u-1' }, { technicianType: 'subcontractor' }),
    ).toEqual({
      userId: 'u-1',
      type: 'subcontractor',
      setUserType: 'subcontractor',
      disableSignIn: true,
    });
  });

  it('the user record wins over the card', () => {
    expect(
      planUserTypeBackfill({ id: 'u-1', userType: 'regular' }, { technicianType: 'subcontractor' }),
    ).toEqual({ userId: 'u-1', type: 'regular', card: { technicianType: 'regular' }, disableSignIn: false });
  });

  it('a User with no card, or a card that agrees, needs nothing', () => {
    expect(planUserTypeBackfill({ id: 'u-1' }, null)).toEqual({
      userId: 'u-1',
      type: 'regular',
      disableSignIn: false,
    });
    expect(planUserTypeBackfill({ id: 'u-1' }, { gpsTrackingEnabled: true })).toEqual({
      userId: 'u-1',
      type: 'regular',
      disableSignIn: false,
    });
  });

  it('a subcontractor with no card still loses the sign-in', () => {
    expect(planUserTypeBackfill({ id: 'u-1', userType: 'subcontractor' }, undefined)).toEqual({
      userId: 'u-1',
      type: 'subcontractor',
      disableSignIn: true,
    });
  });
});
