import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { verifyClientConfirmToken } from '@bitcrm/shared';
import type { ClientConfirmJob, ClientConfirmView } from '@bitcrm/types';
import { BusinessProfileService } from '../business-profile/business-profile.service';
import { formatAddress } from '../documents/document-context.builder';
import { DealClient } from '../integrations/deal.client';

const invalid = () => new NotFoundException('This link is no longer valid');

/**
 * The client's "confirm your appointment" page (B12, Workiz `{{confirm_link}}`
 * — "To confirm your appointment click here"). The link is the job's own
 * signed token (`@bitcrm/shared`, minted by messaging when it renders the
 * reminder); this verifies it, asks deal-service for the job (deal decides
 * whether the visit can still be confirmed, and records the tap), and brands
 * the answer with the job's company, like the portal.
 *
 * It lives beside the portal because it is the same kind of thing: a public,
 * rate-limited page reached by a bearer link in a text, served to
 * `apps/portal`. Nothing here stores anything.
 */
@Injectable()
export class ClientConfirmPageService {
  constructor(
    private readonly profiles: BusinessProfileService,
    @Optional() private readonly deals?: DealClient,
  ) {}

  async view(token: string): Promise<ClientConfirmView> {
    const dealId = this.dealOf(token);
    return this.toView(await this.deals!.getClientConfirm(dealId).catch(notFoundAsNull));
  }

  async confirm(token: string, client: { ip?: string; userAgent?: string }): Promise<ClientConfirmView> {
    const dealId = this.dealOf(token);
    const job = await this.deals!
      .confirmByClient(dealId, {
        via: 'link',
        ...(client.ip && { ip: client.ip.slice(0, 64) }),
        ...(client.userAgent && { userAgent: client.userAgent.slice(0, 512) }),
      })
      .catch(notFoundAsNull);
    return this.toView(job);
  }

  /** The job the link names. Same 404 for a forged, malformed or foreign link — and with no deal client. */
  private dealOf(token: string): string {
    const dealId = this.deals ? verifyClientConfirmToken(token) : null;
    if (!dealId) throw invalid();
    return dealId;
  }

  private async toView(job: ClientConfirmJob | null): Promise<ClientConfirmView> {
    if (!job) throw invalid();
    const business = await this.profiles.getPublic(job.businessProfileId);
    const address = formatAddress(job.address);
    return {
      state: job.state,
      business,
      job: {
        number: job.dealNumber,
        ...(job.scheduledDate && { scheduledDate: job.scheduledDate }),
        ...(job.scheduledEndDate && { scheduledEndDate: job.scheduledEndDate }),
        ...(job.scheduledTimeSlot && { scheduledTimeSlot: job.scheduledTimeSlot }),
        ...(job.allDay && { allDay: true }),
        ...(job.timezone && { timezone: job.timezone }),
        ...(address && { address }),
        ...(job.jobType && { jobType: job.jobType }),
      },
      ...(job.confirmedAt && { confirmedAt: job.confirmedAt }),
    };
  }
}

/** deal-service's 404 (the job vanished) reads as the same invalid link. */
function notFoundAsNull(err: unknown): null {
  if (err instanceof NotFoundException) return null;
  throw err;
}
