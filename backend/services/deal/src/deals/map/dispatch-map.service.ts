import { Injectable, Logger } from '@nestjs/common';
import {
  CLOSED_SUPER_STATUSES,
  DataScope,
  type Deal,
  type DispatchMapClient,
  type DispatchMapIncluded,
  type JwtUser,
  type TechnicianName,
} from '@bitcrm/types';
import { DealsRepository, type MapJobsRead } from '../deals.repository';
import { InternalHttpService } from '../../common/services/internal-http.service';
import { TechnicianEligibilityRepository } from '../../technician-eligibility/technician-eligibility.repository';
import { parseDispatchMapQuery, type DispatchMapQueryDto } from './dispatch-map.query';

/** What crm's by-ids routes and the eligibility batch take in one body. */
const BATCH = 100;

export interface DispatchMapAnswer {
  deals: Deal[];
  included: DispatchMapIncluded;
}

export interface DispatchMapOptions {
  /** The caller holds `contacts.view_numbers`. */
  numbers: boolean;
  /** The caller's own bearer — crm is asked for the clients AS THE CALLER. */
  authorization?: string;
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
 * once (`DealsRepository.readMapJobs`), Done / Canceled only for the date box's
 * days, and sends with the jobs who they name:
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
  ) {}

  async read(
    query: DispatchMapQueryDto,
    caller: JwtUser,
    dataScope: string | undefined,
    opts: DispatchMapOptions,
  ): Promise<DispatchMapAnswer> {
    const { statuses, window } = parseDispatchMapQuery(query);
    const reads: MapJobsRead[] = statuses.map((status) =>
      CLOSED_SUPER_STATUSES.has(status) && window ? { status, window } : { status },
    );
    const techId = dataScope === DataScope.ASSIGNED_ONLY ? caller.id : undefined;
    const rows = await this.repository.readMapJobs(reads, { techId });
    const deals = opts.numbers ? rows : rows.map((d) => withoutNumbers(d));

    const [technicians, clients] = await Promise.all([
      this.technicians(distinct(deals.flatMap((d) => d.assignedTechIds ?? []))),
      this.clients(distinct(deals.map((d) => d.contactId)), opts.authorization),
    ]);
    return { deals, included: { technicians, clients } };
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
