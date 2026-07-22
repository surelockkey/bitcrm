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
  phone?: string;
  homeAddress?: TechnicianHomeAddress;
  profilePhotoUrl?: string;

  // --- Operational settings (manager-controlled) ---
  laborCostPerHour?: number;
  callMaskingEnabled: boolean;
  gpsTrackingEnabled: boolean;
  mobileAppInstalled: boolean;
  status: TechnicianProfileStatus;

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
