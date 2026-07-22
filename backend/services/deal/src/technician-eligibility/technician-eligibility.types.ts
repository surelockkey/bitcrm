/**
 * Deal-service read-model of a technician's assignment eligibility, projected
 * from the user-service `tech.approved` / `tech.updated` events. Backs
 * `GET /deals/:id/qualified-techs`, so it carries enough display data
 * (name, department, home address) to render and rank the assignment dialog
 * without a synchronous call into user-service.
 */
export interface TechnicianEligibility {
  technicianId: string;
  /** Catalog job-type ids the technician is approved for. */
  jobTypeIds: string[];
  /** Catalog service-area ids the technician is approved for. */
  serviceAreaIds: string[];
  assignable: boolean;
  firstName?: string;
  lastName?: string;
  department?: string;
  /**
   * Origin for the distance ranking; absent until the profile is geocoded.
   * Coordinates only — the projection has no reason to hold a street address.
   */
  homeAddress?: { lat: number; lng: number };
  updatedAt: string;
}
