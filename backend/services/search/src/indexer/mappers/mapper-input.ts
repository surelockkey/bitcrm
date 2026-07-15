/**
 * A technician's searchable data is spread across the User (name, department),
 * the TechnicianProfile (phone), and skill/eligibility events (skills, service
 * areas). No single entity holds it all, so the indexer/backfill assembles this
 * flattened input and hands it to `mapTechnician`.
 */
export interface TechnicianSearchInput {
  userId: string;
  firstName: string;
  lastName: string;
  department?: string;
  phone?: string;
  skills?: string[];
  serviceAreas?: string[];
  /** 'active' | 'inactive' | 'pending' etc. */
  status?: string;
  updatedAt: string;
}
