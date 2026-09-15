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

/**
 * The client slice folded into a deal's search document, so a job is findable
 * by whoever it was done for (name, phone, email, company). Resolved by the
 * indexer from crm-service — the deal itself stores only contactId/companyId.
 */
export interface DealClientSearchInput {
  name?: string;
  phones?: string[];
  emails?: string[];
  companyName?: string;
}

/** A job referenced by a conversation: its number for keywords, its roster for `assigned_only`. */
export interface ConversationDealSearchInput {
  id: string;
  dealNumber?: string;
  assignedTechIds?: string[];
}

/** The slice of a message the conversation mapper folds into the document body. */
export interface ConversationMessageSearchInput {
  id: string;
  body?: string;
  subject?: string;
  dealId?: string;
  createdAt: string;
}

/**
 * What the conversation mapper needs beyond the stored conversation
 * (messaging design §7.4): the party's live name and addresses (CRM or
 * user-service), the last N messages of the feed, and the jobs the thread
 * refers to. Resolved by the indexer / backfill; the conversation itself only
 * stores `partyKind` + `partyId`, the addresses it was carried on, and ids.
 */
export interface ConversationSearchInput {
  partyName?: string;
  partyPhones?: string[];
  partyEmails?: string[];
  /** Newest first — the feed page the indexer read. */
  messages?: ConversationMessageSearchInput[];
  deals?: ConversationDealSearchInput[];
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
