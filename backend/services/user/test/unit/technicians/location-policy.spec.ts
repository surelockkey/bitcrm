import { isLocationTracked } from '../../../src/technicians/location/location-policy';
import { createMockTechnicianProfile } from '../mocks';

/**
 * The one rule behind every live-location read and write: the card's
 * "Track location", and never a subcontractor (Workiz: "You will not be able
 * to enable location tracking for subcontractors").
 */
describe('isLocationTracked', () => {
  it('tracks a user whose card has Track location on', () => {
    const profile = createMockTechnicianProfile({ gpsTrackingEnabled: true });
    expect(isLocationTracked(profile, { userType: 'regular' })).toBe(true);
  });

  it('does not track when the card has Track location off', () => {
    const profile = createMockTechnicianProfile({ gpsTrackingEnabled: false });
    expect(isLocationTracked(profile, { userType: 'regular' })).toBe(false);
  });

  it('never tracks a subcontractor, whatever the card says', () => {
    const profile = createMockTechnicianProfile({ gpsTrackingEnabled: true });
    expect(isLocationTracked(profile, { userType: 'subcontractor' })).toBe(false);
  });

  it('a card from before the type moved to the user: its own Subcontractor stops tracking too', () => {
    const profile = createMockTechnicianProfile({
      gpsTrackingEnabled: true,
      technicianType: 'subcontractor',
    });
    expect(isLocationTracked(profile, { id: 'tech-1' })).toBe(false);
  });

  it('a user record without a type is a regular user', () => {
    const profile = createMockTechnicianProfile({ gpsTrackingEnabled: true });
    expect(isLocationTracked(profile, { id: 'tech-1' })).toBe(true);
    expect(isLocationTracked(profile, null)).toBe(true);
  });

  // Nobody has turned tracking off for someone without a card yet; the card
  // seeds the flag the moment it appears.
  it('tracks a person without a card', () => {
    expect(isLocationTracked(null, { userType: 'regular' })).toBe(true);
    expect(isLocationTracked(null, null)).toBe(true);
  });

  it('a subcontractor without a card is still not tracked', () => {
    expect(isLocationTracked(null, { userType: 'subcontractor' })).toBe(false);
  });
});
