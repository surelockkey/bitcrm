/**
 * Deal-service read-model of a technician's assignment eligibility, projected
 * from the user-service `tech.approved` / `tech.updated` events. The EPIC-4
 * assignment algorithm reads this instead of calling user-service per dispatch.
 */
export interface TechnicianEligibility {
  technicianId: string;
  approvedSkills: string[];
  serviceAreas: string[];
  assignable: boolean;
  updatedAt: string;
}
