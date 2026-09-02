/**
 * Technician operational/profile data, stored alongside the User in the
 * single-table design (PK=USER#<id>, SK=TECH_PROFILE).
 *
 * Sensitive documents (DL, SSN, bank account) are NOT part of this entity —
 * they live in encrypted storage and are added in a later phase.
 */
export type TechnicianProfileStatus = 'pending' | 'active' | 'inactive';

export interface TechnicianHomeAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  /** Geocoded coordinates for dispatch distance calculations */
  lat?: number;
  lng?: number;
}

export interface TechnicianProfile {
  /** Same id as the owning User (one profile per user) */
  userId: string;

  // --- Self-filled basic data ---
  /**
   * Read-only here: the number is stored on the owning User, which is what
   * telephony rings and what the call log matches against. The user-service
   * fills this in on read and routes writes to the user record — a technician
   * record must never hold a second, unreachable copy.
   */
  phone?: string;
  homeAddress?: TechnicianHomeAddress;
  profilePhotoUrl?: string;

  // --- Operational settings (manager-controlled) ---
  laborCostPerHour?: number;
  /**
   * @deprecated Replaced by the `contacts.view_numbers` permission, which
   * applies to ANY user rather than only technicians — a dispatcher has no
   * TechnicianProfile to hold a flag on, and forcing one would stamp
   * `GSI3PK='TECHNICIAN'` and put them on the dispatch board.
   *
   * Nothing reads it. Still written for one release so a rollback is safe;
   * `migrate-call-masking.ts` moves the exceptions onto the permission.
   */
  callMaskingEnabled: boolean;
  gpsTrackingEnabled: boolean;
  mobileAppInstalled: boolean;
  status: TechnicianProfileStatus;

  // --- Working hours (manager-controlled; drive schedule dimming + conflicts) ---
  /** Days the tech works: 0=Sun … 6=Sat. Undefined = unset (nothing dimmed). */
  workingDays?: number[];
  /** Shift start "HH:MM" (24h). */
  workStart?: string;
  /** Shift end "HH:MM" (24h). */
  workEnd?: string;

  createdAt: string;
  updatedAt: string;
}

/** Derived onboarding completion view (not persisted). */
export interface OnboardingStatus {
  status: TechnicianProfileStatus;
  checklist: {
    profileComplete: boolean;
    /** ≥1 approved job type AND ≥1 approved service area. */
    assignmentsApproved: boolean;
    commissionSet: boolean;
  };
  completedSteps: number;
  totalSteps: number;
}
