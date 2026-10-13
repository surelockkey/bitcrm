import { createHash } from 'crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import {
  CLOSED_SUPER_STATUSES,
  DataScope,
  type JobSuperStatus,
  type Deal,
  type DispatchMapClient,
  type DispatchMapIncluded,
  type JwtUser,
  type TechnicianName,
} from '@bitcrm/types';
import { DealsRepository, type MapJobsRead } from '../deals.repository';
// Bumped by `DealsCacheService.invalidate` on every job write — part of the key.
import { DISPATCH_MAP_GENERATION_KEY } from '../deals-cache.service';
import { InternalHttpService } from '../../common/services/internal-http.service';
import { TechnicianEligibilityRepository } from '../../technician-eligibility/technician-eligibility.repository';
import { parseDispatchMapQuery, type DispatchMapQueryDto } from './dispatch-map.query';

/** What crm's by-ids routes and the eligibility batch take in one body. */
const BATCH = 100;

/** How long one answer is shared (every task, every tab of the same scope). */
export const DISPATCH_MAP_CACHE_TTL_SECONDS = 10;
const CACHE_PREFIX = 'deal:map:v1:';
/** The any-date count changes slowly and is only a label: shared longer, without the write generation. */
const TOTAL_CACHE_PREFIX = 'deal:map:total:v1:';
export const DISPATCH_MAP_TOTAL_TTL_SECONDS = 30;
/** An answer bigger than this (JSON) is not put in Redis at all. */
const CACHE_MAX_CHARS = 8 * 1024 * 1024;

export interface DispatchMapAnswer {
  deals: Deal[];
  included: DispatchMapIncluded;
  /**
   * Beside a read of some days (`from`/`to`) of open statuses only: how many
   * jobs those statuses hold whatever the date — the board's "out of N open
   * jobs". Absent on a whole read (`deals` is that set) and when it could not
   * be counted.
   */
  totalAnyDate?: number;
}

export interface DispatchMapOptions {
  /** The caller holds `contacts.view_numbers`. */
  numbers: boolean;
  /** The caller's own bearer — crm is asked for the clients AS THE CALLER. */
  authorization?: string;
  /**
   * What crm decides the clients by for this caller (`contacts.view`, the
   * contacts data scope) — only ever part of the cache key.
   */
  contacts?: { view: boolean; scope?: string };
}

const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

const distinct = (ids: Array<string | undefined | null>): string[] =>
  [...new Set(ids.filter((id): id is string => Boolean(id)))];

/**
 * `GET /deals/map` — the dispatch map in one request.
 *
 * The board used to drain the jobs list a hundred rows a page (four statuses,
 * each page after the last) and only then ask crm for the clients by id: five
 * to eight seconds on dev. This reads every open status partition whole and at
 * once (`DealsRepository.readMapJobs`) — or, given `from`/`to`, only the days
 * the board shows — Done / Canceled only for the date box's days, and sends
 * with the jobs who they name:
 *
 * - **technicians** — the eligibility projection, names only (as the jobs list);
 * - **clients** — crm's `POST /contacts/by-ids` with the caller's own token, so
 *   their numbers are masked exactly as crm masks them for this caller; whoever
 *   crm will not show the caller still gets a name (crm's internal names route).
 *
 * A job's own numbers (`Deal.phones`) travel only to a caller with
 * `contacts.view_numbers`, as on the Jobs report. The data scope holds: an
 * `assigned_only` caller gets only the jobs they are on. Neither side-load can
 * fail the map.
 */
@Injectable()
export class DispatchMapService {
  private readonly logger = new Logger(DispatchMapService.name);

  constructor(
    private readonly repository: DealsRepository,
    private readonly internalHttp: InternalHttpService,
    private readonly eligibility: TechnicianEligibilityRepository,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * The answer, shared through Redis for `DISPATCH_MAP_CACHE_TTL_SECONDS`
   * under everything that changes it: the statuses, the window, the deals
   * scope, whether numbers show, and what crm decides the clients by (a
   * contacts scope narrower than `all` answers per person). A job written
   * since misses (`DISPATCH_MAP_GENERATION_KEY`). Best effort: Redis down,
   * or not wired, costs the cache, never the map.
   */
  async read(
    query: DispatchMapQueryDto,
    caller: JwtUser,
    dataScope: string | undefined,
    opts: DispatchMapOptions,
  ): Promise<DispatchMapAnswer> {
    const parsed = parseDispatchMapQuery(query);
    const techId = dataScope === DataScope.ASSIGNED_ONLY ? caller.id : undefined;
    const key = this.redis ? await this.cacheKey(parsed, caller, techId, opts) : undefined;
    if (key) {
      const hit = await this.cacheGet(key);
      if (hit) return hit;
    }
    const answer = await this.readFresh(parsed, techId, opts);
    if (key) await this.cachePut(key, answer);
    return answer;
  }

  private async readFresh(
    { statuses, window }: ReturnType<typeof parseDispatchMapQuery>,
    techId: string | undefined,
    opts: DispatchMapOptions,
  ): Promise<DispatchMapAnswer> {
    // A window bounds every status by visit day: Done / Canceled one query a
    // day, an open status one range read. Without one, the open statuses whole.
    const reads: MapJobsRead[] = statuses.map((status) => (window ? { status, window } : { status }));
    const counted = window && !statuses.some((s) => CLOSED_SUPER_STATUSES.has(s));
    const [rows, totalAnyDate] = await Promise.all([
      this.repository.readMapJobs(reads, { techId }),
      counted ? this.totalAnyDate(statuses, techId) : Promise.resolve(undefined),
    ]);
    const deals = opts.numbers ? rows : rows.map((d) => withoutNumbers(d));

    const [technicians, clients] = await Promise.all([
      this.technicians(distinct(deals.flatMap((d) => d.assignedTechIds ?? []))),
      this.clients(distinct(deals.map((d) => d.contactId)), opts.authorization),
    ]);
    return { deals, included: { technicians, clients }, ...(totalAnyDate !== undefined && { totalAnyDate }) };
  }

  /** The any-date count of the statuses (Redis, 30 s); undefined when it cannot be had. */
  private async totalAnyDate(statuses: readonly JobSuperStatus[], techId: string | undefined): Promise<number | undefined> {
    const key = `${TOTAL_CACHE_PREFIX}${statuses.join(',')}:${techId ?? '*'}`;
    if (this.redis) {
      try {
        const hit = await this.redis.client.get(key);
        if (hit !== null && hit !== undefined && Number.isFinite(Number(hit))) return Number(hit);
      } catch {
        /* counted below */
      }
    }
    try {
      const total = await this.repository.countMapJobs(statuses, { techId });
      if (this.redis) {
        try {
          await this.redis.client.set(key, String(total), 'EX', DISPATCH_MAP_TOTAL_TTL_SECONDS);
        } catch {
          /* served uncached */
        }
      }
      return total;
    } catch (error) {
      this.logger.warn(`Dispatch map: the any-date count is unavailable: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async cacheKey(
    { statuses, window }: ReturnType<typeof parseDispatchMapQuery>,
    caller: JwtUser,
    techId: string | undefined,
    opts: DispatchMapOptions,
  ): Promise<string | undefined> {
    let generation = '0';
    try {
      generation = (await this.redis!.client.get(DISPATCH_MAP_GENERATION_KEY)) ?? '0';
    } catch (error) {
      this.logger.warn(`Dispatch map cache unavailable: ${(error as Error).message}`);
      return undefined;
    }
    const contactsScope = opts.contacts?.scope;
    const personal = contactsScope !== undefined && contactsScope !== DataScope.ALL;
    const parts = {
      statuses,
      window: window ?? null,
      techId: techId ?? null,
      numbers: opts.numbers,
      contactsView: opts.contacts?.view ?? null,
      contactsScope: contactsScope ?? null,
      // crm answers a narrower contacts scope by who is asking.
      who: personal ? caller.id : null,
    };
    return `${CACHE_PREFIX}${generation}:${createHash('sha1').update(JSON.stringify(parts)).digest('hex')}`;
  }

  private async cacheGet(key: string): Promise<DispatchMapAnswer | undefined> {
    try {
      const raw = await this.redis!.client.get(key);
      return raw ? (JSON.parse(raw) as DispatchMapAnswer) : undefined;
    } catch (error) {
      this.logger.warn(`Dispatch map cache read failed: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async cachePut(key: string, answer: DispatchMapAnswer): Promise<void> {
    try {
      const json = JSON.stringify(answer);
      if (json.length > CACHE_MAX_CHARS) return;
      await this.redis!.client.set(key, json, 'EX', DISPATCH_MAP_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Dispatch map cache write failed: ${(error as Error).message}`);
    }
  }

  private async technicians(ids: string[]): Promise<TechnicianName[]> {
    if (!ids.length) return [];
    try {
      const rows = (await Promise.all(chunks(ids, BATCH).map((c) => this.eligibility.getMany(c)))).flat();
      // Rebuilt field by field: the projection also holds a department and a home.
      return rows.map((row) => ({
        id: row.technicianId,
        firstName: row.firstName ?? '',
        lastName: row.lastName ?? '',
        ...(row.workizName && { workizName: row.workizName }),
      }));
    } catch (error) {
      this.logger.warn(`Dispatch map side-load: technician names unavailable: ${(error as Error).message}`);
      return [];
    }
  }

  private async clients(ids: string[], authorization: string | undefined): Promise<DispatchMapClient[]> {
    if (!ids.length) return [];
    const found = new Map<string, DispatchMapClient>();
    try {
      // As the caller: crm masks the numbers exactly as on its own screens.
      const shown = await Promise.all(
        chunks(ids, BATCH).map((c) => this.internalHttp.getContactsAsCaller(c, authorization)),
      );
      for (const c of shown.flat()) {
        if (!c || typeof c.id !== 'string') continue;
        // Rebuilt field by field: the contact's notes, addresses and tags stay in crm.
        found.set(c.id, {
          id: c.id,
          firstName: c.firstName ?? '',
          lastName: c.lastName ?? '',
          phones: Array.isArray(c.phones) ? c.phones : [],
          emails: Array.isArray(c.emails) ? c.emails : [],
          ...(c.phonesMasked && { phonesMasked: true as const }),
        });
      }
      // Whom crm would not show the caller (no `contacts.view`), or could not
      // answer for: the name alone, as the jobs list sends it.
      const unnamed = ids.filter((id) => !found.has(id));
      if (unnamed.length) {
        const named = await Promise.all(chunks(unnamed, BATCH).map((c) => this.internalHttp.getContactNames(c)));
        for (const n of named.flat()) {
          if (!found.has(n.id)) found.set(n.id, { id: n.id, firstName: n.firstName, lastName: n.lastName, phones: [], emails: [] });
        }
      }
    } catch (error) {
      this.logger.warn(`Dispatch map side-load: clients unavailable: ${(error as Error).message}`);
    }
    return ids.flatMap((id) => found.get(id) ?? []);
  }
}

/** The row without the job's own numbers — for a caller without `contacts.view_numbers`. */
function withoutNumbers(deal: Deal): Deal {
  const { phones: _phones, phoneExtensions: _extensions, clientPhone: _clientPhone, ...rest } = deal;
  return rest;
}
