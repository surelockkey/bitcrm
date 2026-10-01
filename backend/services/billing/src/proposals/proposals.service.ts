import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TimelineEventType, type Estimate, type PortalProposalSummary, type Proposal } from '@bitcrm/types';
import { assertDealAccess, type Caller } from '../common/access';
import { EstimatesService } from '../estimates/estimates.service';
import { DealClient } from '../integrations/deal.client';
import { ProposalsRepository } from './proposals.repository';

/** Workiz `auto_decline_same_job`: picking one option declines the others. */
export const UNSELECTED_OPTION_REASON = 'Another option was approved';

const isOpen = (e: Pick<Estimate, 'status'>) => e.status === 'unsent' || e.status === 'pending';

/**
 * Sales proposals (Workiz "Send all (proposal)"): the job's open estimates
 * go out together; the client approves ONE by signing it, which decides the
 * proposal and declines the other options.
 */
@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    private readonly repo: ProposalsRepository,
    private readonly estimates: EstimatesService,
    private readonly deal: DealClient,
  ) {}

  /**
   * Bundles the job's open estimates that are not already out in a pending
   * proposal, marks every one of them sent, and records the proposal.
   */
  async createAndSend(dealId: string, caller: Caller): Promise<Proposal> {
    const all = await this.estimates.listByDeal(dealId, caller);
    const options = all.filter((e) => isOpen(e) && !e.proposalId);
    if (options.length === 0) {
      throw new UnprocessableEntityException('This job has no open estimate to send as a proposal');
    }
    const first = options[0];
    const seq = await this.repo.nextSeq();
    const now = new Date().toISOString();
    const proposal: Proposal = {
      id: randomUUID(),
      number: String(seq),
      dealId,
      dealNumber: first.dealNumber ?? '',
      contactId: first.contactId,
      ...(first.companyId && { companyId: first.companyId }),
      estimateIds: options.map((e) => e.id),
      status: 'pending',
      sentAt: now,
      sentBy: caller.user.id,
      version: 1,
      createdBy: caller.user.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(proposal);
    await this.estimates.attachToProposal(proposal.estimateIds, proposal.id, caller);
    await this.deal.addTimeline(
      dealId,
      TimelineEventType.PROPOSAL_SENT,
      caller.user.id,
      { proposalId: proposal.id, number: proposal.number, estimateIds: proposal.estimateIds },
      caller.user.email,
    );
    return proposal;
  }

  async get(id: string, caller: Caller): Promise<Proposal> {
    const p = await this.repo.get(id);
    if (!p) throw new NotFoundException('Proposal not found');
    await this.assertAccess(p, caller);
    return p;
  }

  /** Newest first. */
  async listByDeal(dealId: string, caller: Caller): Promise<Proposal[]> {
    const rows = await this.repo.listByDeal(dealId);
    if (rows.length) await this.assertAccess(rows[0], caller);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The portal's list: every proposal sent to the contact, newest first (options filled in by the portal). */
  async listForContact(contactId: string): Promise<Omit<PortalProposalSummary, 'options'>[]> {
    const rows = await this.repo.listByContact(contactId);
    return rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({
        id: p.id,
        number: p.number,
        status: p.status,
        sentAt: p.sentAt,
        estimateIds: p.estimateIds,
        ...(p.selectedEstimateId && { selectedEstimateId: p.selectedEstimateId }),
      }));
  }

  /**
   * The client approved an estimate: if it is an option of a pending
   * proposal, the proposal is decided and the other open options are declined.
   */
  async onEstimateApproved(estimateId: string): Promise<Proposal | undefined> {
    const proposal = await this.proposalOf(estimateId);
    if (!proposal || proposal.status !== 'pending') return proposal;
    const now = new Date().toISOString();
    const updated = await this.repo.update(proposal.id, {
      status: 'approved',
      selectedEstimateId: estimateId,
      decidedAt: now,
      updatedAt: now,
    });
    for (const id of proposal.estimateIds) {
      if (id === estimateId) continue;
      const sibling = await this.estimates.getStored(id);
      if (!sibling || !isOpen(sibling)) continue;
      try {
        await this.estimates.declineByClient(id, { reason: UNSELECTED_OPTION_REASON });
      } catch (err) {
        this.logger.warn(`proposal ${proposal.id}: option ${id} not declined: ${(err as Error).message}`);
      }
    }
    return updated;
  }

  /** The client declined an option: when none is left open, the proposal is declined. */
  async onEstimateDeclined(estimateId: string): Promise<Proposal | undefined> {
    const proposal = await this.proposalOf(estimateId);
    if (!proposal || proposal.status !== 'pending') return proposal;
    for (const id of proposal.estimateIds) {
      const e = await this.estimates.getStored(id);
      if (e && e.status !== 'declined') return proposal;
    }
    const now = new Date().toISOString();
    return this.repo.update(proposal.id, { status: 'declined', decidedAt: now, updatedAt: now });
  }

  private async proposalOf(estimateId: string): Promise<Proposal | undefined> {
    const estimate = await this.estimates.getStored(estimateId);
    if (!estimate?.proposalId) return undefined;
    return (await this.repo.get(estimate.proposalId)) ?? undefined;
  }

  private async assertAccess(p: Proposal, caller: Caller): Promise<void> {
    const view = await this.deal.getBillingView(p.dealId);
    if (!view) throw new NotFoundException('Job not found');
    assertDealAccess(caller, 'estimates', view.deal);
  }
}
