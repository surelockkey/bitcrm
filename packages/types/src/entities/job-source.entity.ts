/**
 * Where a deal came from (Google Ads, Referral, Repeat Customer, …), managed as
 * a catalog in Settings. A deal references at most one. Unlike job types, sources
 * touch nothing else — no technicians, no eligibility, no search indexing.
 *
 * Same priority/active semantics, repository shape and settings UI as JobType.
 */
export interface JobSource {
  id: string;
  name: string;
  /** Higher sorts first in pickers; also the list sort key. */
  priority: number;
  /** Archived sources stay resolvable on historical deals but leave the pickers. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
