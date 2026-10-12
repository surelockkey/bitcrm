import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { normalizePhone, SnsPublisherService } from '@bitcrm/shared';
import {
  DealStatus,
  type ClientPhoneChangeResult,
  type ClientPhoneScope,
  type Deal,
  type JwtUser,
} from '@bitcrm/types';
import { InternalHttpService } from '../../common/services/internal-http.service';
import { DealsCacheService } from '../deals-cache.service';
import { DealsRepository } from '../deals.repository';
import { nextClientPhone, type ClientPhoneChange } from './client-phone.rules';

/** A page of the client's jobs on the contact index. */
const PAGE = 100;

/**
 * The job side of a first number changed on the job page ("Apply these
 * changes to…", `client-phone.rules.ts`): this job's own number, and — when
 * the change goes to the client profile — the client's other jobs, pinned to
 * the old number or moved to the new one.
 *
 * The profile itself is crm's and the page writes it with the rest of the
 * client's edits, AFTER this call: the old number is read from crm here
 * while it still stands. Nothing goes to the timeline — it would print the
 * digits to everyone who reads the job's history.
 */
@Injectable()
export class ClientPhoneService {
  private readonly logger = new Logger(ClientPhoneService.name);

  constructor(
    private readonly repository: DealsRepository,
    private readonly cache: DealsCacheService,
    private readonly internalHttp: InternalHttpService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  async change(
    dealId: string,
    dto: { phone: string; scope: ClientPhoneScope },
    caller: JwtUser,
  ): Promise<ClientPhoneChangeResult> {
    const deal = await this.repository.findById(dealId);
    if (!deal || deal.status === DealStatus.DELETED) throw new NotFoundException(`Deal ${dealId} not found`);
    const phone = normalizePhone(dto.phone);
    const contact = await this.internalHttp.getContact(deal.contactId);
    const change: ClientPhoneChange = { dealId, phone, previous: contact?.phones?.[0], scope: dto.scope };

    const updated = await this.apply(deal, change, caller);
    let otherJobsChanged = 0;
    if (change.scope !== 'job') {
      let cursor: string | undefined;
      do {
        const page = await this.repository.findByContact(deal.contactId, PAGE, cursor);
        for (const job of page.items) {
          if (job.id === dealId) continue;
          if (await this.apply(job, change, caller)) otherJobsChanged += 1;
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    return { deal: updated ?? deal, otherJobsChanged };
  }

  /** One job's write, when its number moves; null when it stays or the job went meanwhile. */
  private async apply(job: Deal, change: ClientPhoneChange, caller: JwtUser): Promise<Deal | null> {
    const next = nextClientPhone(job, change);
    if (next === undefined) return null;
    let written: Deal;
    try {
      written = await this.repository.update(job.id, { clientPhone: next });
    } catch (error) {
      if ((error as Error).name === 'ConditionalCheckFailedException') return null;
      throw error;
    }
    await this.cache.invalidate(job.id);
    this.snsPublisher
      ?.publish('deal-events', 'deal.updated', { dealId: job.id, updatedBy: caller.id })
      .catch((error: Error) => this.logger.warn(`Failed to publish deal.updated: ${error.message}`));
    return written;
  }
}
