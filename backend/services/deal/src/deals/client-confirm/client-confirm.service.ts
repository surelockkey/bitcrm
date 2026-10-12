import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import {
  DealEventType,
  TimelineEventType,
  clientConfirmScheduleKey,
  type ClientConfirmJob,
  type ClientConfirmRequest,
  type Deal,
  type DealClientConfirmedEvent,
} from '@bitcrm/types';
import { JobTypesService } from '../../job-types/job-types.service';
import { ServiceAreasService } from '../../service-areas/service-areas.service';
import { TimelineRepository } from '../../timeline/timeline.repository';
import { DealsCacheService } from '../deals-cache.service';
import { DealsRepository } from '../deals.repository';
import { REPORT_TIMEZONE } from '../report/report-dates';
import { clientConfirmState } from './client-confirm.rules';

/** Who the history names: Workiz writes the line with no user; ours says it was the client. */
const CLIENT_ACTOR = { id: 'client', name: 'Client' } as const;

/**
 * The client confirms their visit through `{{confirm_link}}` (B12) — the job
 * half. Billing's public confirm routes verify the link's token and call the
 * two internal routes in front of this; everything about the JOB is decided
 * here: whether it can still be confirmed (`clientConfirmState`, on the job's
 * own clock), the write, Workiz's "Client Confirmed job" line in the history
 * and `deal.client_confirmed` for the automations ("client confirmed → tell
 * the dispatcher").
 *
 * No sub-status is set: Workiz's confirmation changes none (the two jobs
 * confirmed in the account's history kept the status the dispatcher gave
 * them); a rule with a `change_sub_status` action can, if the office wants it.
 */
@Injectable()
export class ClientConfirmService {
  private readonly logger = new Logger(ClientConfirmService.name);

  constructor(
    private readonly repository: DealsRepository,
    private readonly cache: DealsCacheService,
    private readonly timeline: TimelineRepository,
    @Optional() private readonly serviceAreas?: ServiceAreasService,
    @Optional() private readonly jobTypes?: JobTypesService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  /** The job as the confirm page shows it. 404 when there is no such job. */
  async view(dealId: string, now: Date = new Date()): Promise<ClientConfirmJob> {
    return this.describe(await this.load(dealId), now);
  }

  /**
   * Confirms the visit when it can be (state `open`), once: a repeat tap, the
   * loser of a race, a closed job and a visit that is over all change nothing
   * and answer the state as it is (`recorded: false`).
   */
  async confirm(dealId: string, req: ClientConfirmRequest, now: Date = new Date()): Promise<ClientConfirmJob> {
    const deal = await this.load(dealId);
    const current = await this.describe(deal, now);
    if (current.state !== 'open') return { ...current, recorded: false };

    const at = now.toISOString();
    const via = req.via ?? 'link';
    const visit = clientConfirmScheduleKey(deal);
    const recorded = await this.repository.recordClientConfirmation(dealId, {
      at,
      via,
      ...(deal.contactId && { by: deal.contactId }),
      visit,
    });
    if (!recorded) {
      // Somebody else's tap landed first: answer what is there now.
      return { ...(await this.describe(await this.load(dealId), now)), recorded: false };
    }

    await this.cache.invalidate(dealId).catch((err: Error) => this.logger.warn(`cache not invalidated: ${err.message}`));
    await this.timeline
      .addEntry({
        id: randomUUID(),
        dealId,
        ...(deal.contactId && { contactId: deal.contactId }),
        eventType: TimelineEventType.CLIENT_CONFIRMED,
        actorId: CLIENT_ACTOR.id,
        actorName: CLIENT_ACTOR.name,
        timestamp: at,
        details: {
          via,
          visit,
          ...(req.ip && { ip: req.ip }),
          ...(req.userAgent && { userAgent: req.userAgent }),
        },
      })
      .catch((err: Error) => this.logger.warn(`client confirmation of ${dealId} not in the history: ${err.message}`));

    const event: DealClientConfirmedEvent = {
      dealId,
      dealNumber: deal.dealNumber,
      ...(deal.contactId && { contactId: deal.contactId }),
      confirmedAt: at,
      via,
      visit,
    };
    this.snsPublisher
      ?.publish('deal-events', DealEventType.DEAL_CLIENT_CONFIRMED, event as unknown as Record<string, unknown>)
      .catch((err: Error) => this.logger.warn(`${DealEventType.DEAL_CLIENT_CONFIRMED} not published: ${err.message}`));

    const confirmed: Deal = { ...deal, clientConfirmedAt: at, clientConfirmedVia: via, clientConfirmedFor: visit || undefined };
    return { ...(await this.describe(confirmed, now)), recorded: true };
  }

  private async load(dealId: string): Promise<Deal> {
    const deal = await this.repository.findById(dealId);
    if (!deal) throw new NotFoundException('This link is no longer valid');
    return deal;
  }

  private async describe(deal: Deal, now: Date): Promise<ClientConfirmJob> {
    const [timezone, jobType] = await Promise.all([this.timezoneOf(deal), this.jobTypeName(deal.jobTypeId)]);
    const state = clientConfirmState(deal, now, timezone);
    return {
      dealId: deal.id,
      dealNumber: deal.dealNumber,
      state,
      ...(deal.scheduledDate && { scheduledDate: deal.scheduledDate }),
      ...(deal.scheduledEndDate && { scheduledEndDate: deal.scheduledEndDate }),
      ...(deal.scheduledTimeSlot && { scheduledTimeSlot: deal.scheduledTimeSlot }),
      ...(deal.allDay && { allDay: true }),
      timezone,
      ...(deal.address && { address: deal.address }),
      ...(jobType && { jobType }),
      ...(deal.businessProfileId && { businessProfileId: deal.businessProfileId }),
      ...(state === 'confirmed' && deal.clientConfirmedAt && { confirmedAt: deal.clientConfirmedAt }),
    };
  }

  /** The visit's clock: the job's own zone, else its service area's, else the account's. */
  private async timezoneOf(deal: Deal): Promise<string> {
    if (deal.jobTimezone) return deal.jobTimezone;
    if (deal.serviceAreaId && this.serviceAreas) {
      try {
        const zone = (await this.serviceAreas.findById(deal.serviceAreaId))?.timezone;
        if (zone) return zone;
      } catch {
        // An archived or missing area: the account's clock.
      }
    }
    return REPORT_TIMEZONE;
  }

  private async jobTypeName(id: string | undefined): Promise<string | undefined> {
    if (!id || !this.jobTypes) return undefined;
    try {
      return (await this.jobTypes.findById(id))?.name;
    } catch {
      return undefined;
    }
  }
}
