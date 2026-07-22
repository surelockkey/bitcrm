/**
 * A technician's searchable data is spread across the User (name, department),
 * the TechnicianProfile (phone), and assignment/eligibility events (job types,
 * service areas). No single entity holds it all, so the indexer/backfill assembles this
 * flattened input and hands it to `mapTechnician`.
 */
export interface TechnicianSearchInput {
  userId: string;
  firstName: string;
  lastName: string;
  department?: string;
  phone?: string;
  /** Approved job-type NAMES, resolved from catalog ids by the indexer. */
  jobTypes?: string[];
  /** Approved service-area NAMES, resolved from catalog ids by the indexer. */
  serviceAreas?: string[];
  /** 'active' | 'inactive' | 'pending' etc. */
  status?: string;
  updatedAt: string;
}
