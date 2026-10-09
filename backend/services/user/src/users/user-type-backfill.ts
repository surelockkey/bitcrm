import type { TechnicianProfile, User, UserType } from '@bitcrm/types';

/** What `backfill:user-type` does for one person. */
export interface UserTypeBackfillPlan {
  userId: string;
  /** The type the person has once the backfill is done. */
  type: UserType;
  /** Written on the user record: a type the card held and the user did not (the old form). */
  setUserType?: UserType;
  /** Written on the card: its copy of the type, and tracking off for a subcontractor. */
  card?: { technicianType: UserType; gpsTrackingEnabled?: false };
  /** A subcontractor cannot sign in: the Cognito account goes off (idempotent). */
  disableSignIn: boolean;
}

/**
 * One person's part of `backfill:user-type`. The user record wins; a card that
 * says Subcontractor where the user says nothing is the old technician form,
 * whose answer moves onto the user. Pure — the script reads and writes.
 */
export function planUserTypeBackfill(
  user: Pick<User, 'id' | 'userType'>,
  profile: Partial<Pick<TechnicianProfile, 'technicianType' | 'gpsTrackingEnabled'>> | null | undefined,
): UserTypeBackfillPlan {
  const type: UserType =
    user.userType ?? (profile?.technicianType === 'subcontractor' ? 'subcontractor' : 'regular');
  const plan: UserTypeBackfillPlan = { userId: user.id, type, disableSignIn: type === 'subcontractor' };
  if (!user.userType && type === 'subcontractor') plan.setUserType = type;
  if (profile) {
    const stopTracking = type === 'subcontractor' && profile.gpsTrackingEnabled === true;
    if ((profile.technicianType ?? 'regular') !== type || stopTracking) {
      plan.card = { technicianType: type, ...(stopTracking ? { gpsTrackingEnabled: false as const } : {}) };
    }
  }
  return plan;
}
