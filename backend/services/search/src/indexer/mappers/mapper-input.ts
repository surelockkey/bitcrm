/**
 * A technician's searchable data is spread across the User (name, department),
 * the TechnicianProfile (phone), and assignment/eligibility events (job types,
 * service areas). No single entity holds it all, so the indexer/backfill assembles this
 * flattened input and hands it to `mapTechnician`.
 */
/**
 * The slice of a CustomFieldDefinition the deal mapper needs to fold a deal's
 * stored answers into searchable text: the definition id and whether its value
 * is indexed. Resolved by the indexer from the deal-service
 * `custom-fields/internal` endpoint (which mirrors the job-types catalog fetch).
 */
export interface CustomFieldSearchDef {
  id: string;
  searchable: boolean;
}

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
