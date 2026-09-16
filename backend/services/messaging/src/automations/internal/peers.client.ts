import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from '../../outbound/internal/internal-fetch';

const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

/** The slice of a deal the automations decide on. */
export interface AutomationDeal {
  id: string;
  dealNumber?: string;
  contactId?: string;
  /** `YYYY-MM-DD` in the job's zone; what a reschedule changes. */
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  assignedTechIds: string[];
  assignedDispatcherId?: string;
  superStatus?: string;
}

/** The slice of a user the automations text. */
export interface AutomationUser {
  id: string;
  firstName?: string;
  lastName?: string;
  /** E.164 personal phone (`User.phone`), absent when never set. */
  phone?: string;
  /** Work email (`User.email`) — where the `email` channel of "Send to tech" goes. */
  email?: string;
  status?: string;
}

/**
 * One (technician, channel) outcome of a `deal.sent_to_tech`, reported to
 * deal-service so the job page can show what reached whom. Mirrors
 * `RecordSentToTechDto` in deal-service (EVENTS.md).
 */
export interface SentToTechReport {
  techId: string;
  channel: string;
  status: 'sent' | 'skipped' | 'failed';
  /** The `sentAt` of the click this delivery belongs to. */
  sentAt: string;
  reason?: string;
  messageId?: string;
  conversationId?: string;
  at?: string;
}

/**
 * Deal and user reads for the automations — `GET /api/deals/internal/:id`
 * and `GET /api/users/internal/:id` with `x-internal-secret`, like the
 * other internal clients — plus the one write back,
 * `PUT /api/deals/internal/:id/sent-to-tech`. Deliberately **uncached**: an
 * event handler decides on the job as it is now (a reschedule right after
 * an assignment must not read a 60 s-old copy), and events are rare.
 * `null` means "not found or not reachable"; the handler skips and SQS
 * redelivers on throw only for what it rethrows.
 */
@Injectable()
export class AutomationPeersClient {
  private readonly logger = new Logger(AutomationPeersClient.name);

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async deal(dealId: string): Promise<AutomationDeal | null> {
    const raw = await this.getJson<Partial<AutomationDeal>>(
      `${DEAL_SERVICE_URL}/api/deals/internal/${encodeURIComponent(dealId)}`,
      `deal ${dealId}`,
    );
    if (!raw?.id) return null;
    return {
      id: raw.id,
      dealNumber: raw.dealNumber,
      contactId: raw.contactId,
      scheduledDate: raw.scheduledDate,
      scheduledTimeSlot: raw.scheduledTimeSlot,
      assignedTechIds: raw.assignedTechIds ?? [],
      assignedDispatcherId: raw.assignedDispatcherId,
      superStatus: raw.superStatus,
    };
  }

  async user(userId: string): Promise<AutomationUser | null> {
    const raw = await this.getJson<Partial<AutomationUser>>(
      `${USER_SERVICE_URL}/api/users/internal/${encodeURIComponent(userId)}`,
      `user ${userId}`,
    );
    if (!raw?.id) return null;
    return {
      id: raw.id,
      firstName: raw.firstName,
      lastName: raw.lastName,
      phone: raw.phone || undefined,
      email: raw.email || undefined,
      status: raw.status,
    };
  }

  /**
   * "This is what happened to one channel of the send" — best-effort: the
   * dispatcher's click already stamped the job (Workiz stamps at the click,
   * not at delivery), so a lost report only costs the per-channel detail on
   * the job page. Never throws; answers whether deal-service took it.
   */
  async reportSentToTech(dealId: string, report: SentToTechReport): Promise<boolean> {
    try {
      const res = await this.fetchImpl(
        `${DEAL_SERVICE_URL}/api/deals/internal/${encodeURIComponent(dealId)}/sent-to-tech`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
          body: JSON.stringify(report),
        },
      );
      if (!res.ok) {
        this.logger.warn(`sent-to-tech report for ${dealId}/${report.techId} (${report.channel}) returned ${res.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `sent-to-tech report for ${dealId}/${report.techId} (${report.channel}) failed: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  private async getJson<T>(url: string, what: string): Promise<T | null> {
    try {
      const res = await this.fetchImpl(url, { headers: { 'x-internal-secret': INTERNAL_SECRET } });
      if (!res.ok) {
        if (res.status !== 404) this.logger.warn(`${what} lookup returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { data?: T | null };
      return body?.data ?? null;
    } catch (error) {
      this.logger.warn(`${what} lookup failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
