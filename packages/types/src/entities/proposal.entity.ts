import type { PortalDocumentSummary } from './portal.entity';

/**
 * A sales proposal (Workiz "good / better / best", `Send all (proposal)`):
 * the job's open estimates sent together as ONE thing the client picks
 * from. It owns no lines — each option stays a normal estimate (numbered
 * `<job>-<n>`, approved by signing); the proposal only remembers which
 * options went out together and which one was chosen.
 */
export const PROPOSAL_STATUSES = ['pending', 'approved', 'declined', 'archived'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface Proposal {
  id: string;
  /** Account-wide sequence (Workiz "Proposal #256"). */
  number: string;
  dealId: string;
  dealNumber: string;
  contactId: string;
  companyId?: string;
  /** The options, in the order they sit on the job. */
  estimateIds: string[];
  status: ProposalStatus;
  /** The option the client approved. */
  selectedEstimateId?: string;
  decidedAt?: string;
  sentAt: string;
  sentBy: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A proposal as the client portal lists it, with its options. */
export interface PortalProposalSummary {
  id: string;
  number: string;
  status: ProposalStatus;
  sentAt: string;
  estimateIds: string[];
  selectedEstimateId?: string;
  /** The options, in order — the same summaries the inbox lists. */
  options: PortalDocumentSummary[];
  /** The job's company, when it differs between documents. */
  companyName?: string;
}
