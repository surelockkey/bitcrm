import { type TechnicianProfile } from '@bitcrm/types';
import { deriveOnboardingStatus } from '../../../src/technicians/onboarding.util';

function profile(overrides?: Partial<TechnicianProfile>): TechnicianProfile {
  return {
    userId: 'tech-1',
    callMaskingEnabled: false,
    gpsTrackingEnabled: false,
    mobileAppInstalled: false,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const complete = {
  phone: '404-555-0123',
  homeAddress: { line1: '1 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
  profilePhotoUrl: 'https://x/y.jpg',
};

describe('deriveOnboardingStatus', () => {
  it('reports nothing complete for a null profile', () => {
    const s = deriveOnboardingStatus(null, { assignmentsApproved: false, commissionSet: false });
    expect(s).toEqual({
      status: 'pending',
      checklist: { profileComplete: false, assignmentsApproved: false, commissionSet: false },
      completedSteps: 0,
      totalSteps: 3,
    });
  });

  it('marks profileComplete only when phone + address + photo are all present', () => {
    expect(
      deriveOnboardingStatus(profile(complete), { assignmentsApproved: false, commissionSet: false })
        .checklist.profileComplete,
    ).toBe(true);

    // each missing field flips it false
    for (const key of ['phone', 'homeAddress', 'profilePhotoUrl'] as const) {
      const partial = { ...complete } as Record<string, unknown>;
      delete partial[key];
      expect(
        deriveOnboardingStatus(profile(partial), {
          assignmentsApproved: false,
          commissionSet: false,
        }).checklist.profileComplete,
      ).toBe(false);
    }
  });

  it('counts completed steps across all three inputs', () => {
    const s = deriveOnboardingStatus(profile(complete), {
      assignmentsApproved: true,
      commissionSet: false,
    });
    expect(s.checklist).toEqual({
      profileComplete: true,
      assignmentsApproved: true,
      commissionSet: false,
    });
    expect(s.completedSteps).toBe(2);
  });

  it('reflects the persisted profile status and reaches 3/3 when fully onboarded', () => {
    const s = deriveOnboardingStatus(profile({ ...complete, status: 'active' }), {
      assignmentsApproved: true,
      commissionSet: true,
    });
    expect(s.status).toBe('active');
    expect(s.completedSteps).toBe(3);
  });
});
