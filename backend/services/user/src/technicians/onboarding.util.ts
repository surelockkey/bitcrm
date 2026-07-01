import { type TechnicianProfile, type OnboardingStatus } from '@bitcrm/types';

/**
 * Inputs that come from other modules (skills, commission). They are passed in
 * so this stays a pure, fully-testable function. Phases 2/3 wire the real
 * lookups; until then the service passes `false`.
 */
export interface OnboardingInputs {
  skillsApproved: boolean;
  commissionSet: boolean;
}

/** A profile is "complete" once the technician has self-filled the required basics. */
function isProfileComplete(profile: TechnicianProfile | null): boolean {
  return Boolean(profile?.phone && profile?.homeAddress && profile?.profilePhotoUrl);
}

export function deriveOnboardingStatus(
  profile: TechnicianProfile | null,
  inputs: OnboardingInputs,
): OnboardingStatus {
  const checklist = {
    profileComplete: isProfileComplete(profile),
    skillsApproved: inputs.skillsApproved,
    commissionSet: inputs.commissionSet,
  };

  const completedSteps = Object.values(checklist).filter(Boolean).length;

  return {
    status: profile?.status ?? 'pending',
    checklist,
    completedSteps,
    totalSteps: 3,
  };
}
