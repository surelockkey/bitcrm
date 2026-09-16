import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from '../../outbound/internal/internal-fetch';

const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

/** `userIdsByRole` walks the internal listing; a role's membership changes rarely. */
const ROLE_CACHE_TTL_MS = 60_000;
const ROLE_PAGE_SIZE = 200;
const ROLE_PAGE_LIMIT = 25;

/** The slice of a deal the automations decide on. */
export interface AutomationDeal {
  id: string;
  dealNumber?: string;
  contactId?: string;
  /** `YYYY-MM-DD` in the job's zone; what a reschedule changes. */
  scheduledDate?: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  assignedTechIds: string[];
  assignedDispatcherId?: string;
  superStatus?: string;
  // --- what the rule engine's conditions read (M21 L)
  subStatusId?: string;
  tagIds?: string[];
  sourceId?: string;
  jobTypeId?: string;
  serviceAreaId?: string;
  priority?: string;
  paymentStatus?: string;
  /** Re-stamped by deal-service on every real status move — the stable half of a status occurrence key. */
  statusChangedAt?: string;
  createdAt?: string;
}

/** The slice of a user the automations text. */
export interface AutomationUser {
  id: string;
  firstName?: string;
  lastName?: string;
  /** E.164 personal phone (`User.phone`), absent when never set. */
  phone?: string;
  status?: string;
}

/**
 * Deal and user reads for the automations — `GET /api/deals/internal/:id`
 * and `GET /api/users/internal/:id` with `x-internal-secret`, like the
 * other internal clients. Deliberately **uncached**: an event handler
 * decides on the job as it is now (a reschedule right after an assignment
 * must not read a 60 s-old copy), and events are rare. `null` means "not
 * found or not reachable"; the handler skips and SQS redelivers on throw
 * only for what it rethrows.
 */
@Injectable()
export class AutomationPeersClient {
  private readonly logger = new Logger(AutomationPeersClient.name);
  private readonly roleCache = new Map<string, { ids: string[]; expiresAt: number }>();

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
      scheduledEndDate: raw.scheduledEndDate,
      scheduledTimeSlot: raw.scheduledTimeSlot,
      assignedTechIds: raw.assignedTechIds ?? [],
      assignedDispatcherId: raw.assignedDispatcherId,
      superStatus: raw.superStatus,
      subStatusId: raw.subStatusId,
      tagIds: raw.tagIds ?? [],
      sourceId: raw.sourceId,
      jobTypeId: raw.jobTypeId,
      serviceAreaId: raw.serviceAreaId,
      priority: raw.priority,
      paymentStatus: raw.paymentStatus,
      statusChangedAt: raw.statusChangedAt,
      createdAt: raw.createdAt,
    };
  }

  /**
   * Every active user holding `roleId` — what a Workiz `receiverType: role`
   * notification goes to. user-service has no by-role listing, so the
   * internal `all` page is walked and filtered; the answer is cached for a
   * minute because a rule can fire many times in a burst.
   */
  async userIdsByRole(roleId: string): Promise<string[]> {
    if (!roleId) return [];
    const hit = this.roleCache.get(roleId);
    if (hit && hit.expiresAt > Date.now()) return hit.ids;

    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < ROLE_PAGE_LIMIT; page += 1) {
      const url = `${USER_SERVICE_URL}/api/users/internal/all?limit=${ROLE_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body = await this.getJson<{ items?: Array<{ id: string; roleId?: string; status?: string }>; nextCursor?: string }>(
        url,
        `users by role ${roleId}`,
      );
      if (!body) break;
      for (const u of body.items ?? []) {
        if (u.roleId === roleId && (!u.status || u.status === 'active')) ids.push(u.id);
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    this.roleCache.set(roleId, { ids, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
    return ids;
  }

  async user(userId: string): Promise<AutomationUser | null> {
    const raw = await this.getJson<Partial<AutomationUser>>(
      `${USER_SERVICE_URL}/api/users/internal/${encodeURIComponent(userId)}`,
      `user ${userId}`,
    );
    if (!raw?.id) return null;
    return { id: raw.id, firstName: raw.firstName, lastName: raw.lastName, phone: raw.phone || undefined, status: raw.status };
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
