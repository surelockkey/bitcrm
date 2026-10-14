import { CLOSED_SUPER_STATUSES, SUPER_STATUS_ORDER } from "@bitcrm/types";
import type {
  Contact,
  Deal,
  DispatchMapClient,
  DispatchMapIncluded,
  JobSuperStatus,
  PaginatedResponse,
  TechnicianName,
} from "@bitcrm/types";
import { apiFetchPaginated } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";
import { fetchAllDeals } from "@/features/deals/api";
import { windowRequests } from "@/features/deals/window";
import { getContactsByIds } from "@/features/clients/api";

/**
 * What the map asks deal-service: the statuses (none = the four open ones)
 * and the visit days — without days the open ones are read whole, whatever
 * their date; Done / Canceled always need days.
 */
export interface DispatchMapQuery {
  statuses?: JobSuperStatus[];
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
}

/** `GET /deals/map`: every job asked for at once, and who they name. */
export interface DispatchMapPage extends PaginatedResponse<Deal> {
  pagination: PaginatedResponse<Deal>["pagination"] & {
    /** Beside a read of some days of open statuses: how many there are whatever the date. */
    totalAnyDate?: number;
  };
  included?: DispatchMapIncluded;
}

/** One read of the map: the jobs, their clients, and their techs' names. */
export interface DispatchJobs {
  /** `Deal`s cut to what the map draws — open the job (`GET /deals/:id`) for the rest. */
  deals: Deal[];
  /** Names, numbers and emails as crm shows them to the viewer. */
  clients: DispatchMapClient[];
  /**
   * The names of the techs on these jobs. `null` when the API sent none — a
   * deal-service from before `/deals/map` — and the board names them from its
   * own directory.
   */
  technicians: TechnicianName[] | null;
  /**
   * How many jobs the statuses hold whatever the date, when only some days
   * were read — the board's "out of N open jobs". Undefined for a whole read
   * (`deals` is that set) or from a deal-service that does not send it.
   */
  totalAnyDate?: number;
}

/** The statuses a job is still alive in — what the map reads by default. */
const OPEN_STATUSES: JobSuperStatus[] = SUPER_STATUS_ORDER.filter((s) => !CLOSED_SUPER_STATUSES.has(s));

function mapPath(q: DispatchMapQuery): string {
  const params = new URLSearchParams();
  if (q.statuses?.length) params.set("statuses", q.statuses.join(","));
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  return params.size ? `/deals/map?${params}` : "/deals/map";
}

/** The rows a contact is reduced to on the map: what the cards print and the search reads. */
function asMapClient(c: Contact): DispatchMapClient {
  return {
    id: c.id,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    phones: c.phones ?? [],
    emails: c.emails ?? [],
    ...(c.phonesMasked && { phonesMasked: true as const }),
  };
}

/**
 * The map's jobs in ONE request: `GET /deals/map`.
 *
 * It used to take the jobs list drained a hundred rows a page — four statuses,
 * each page waiting for the last (`pending` alone three round trips) — and
 * then, only once every page was in, one more request for the clients' names:
 * 5–8 s on dev. deal-service now reads every status partition at once and
 * sends the names with the jobs.
 *
 * A deal-service that predates the route answers it with `GET /deals/:id`'s
 * 404 ("Deal map not found"); then, and only then, the map is read the old
 * way, so a web deployed first still works. Any other failure is the board's
 * "Couldn't load jobs".
 */
export async function readDispatchJobs(q: DispatchMapQuery): Promise<DispatchJobs> {
  try {
    const page = await apiFetchPaginated<Deal, DispatchMapPage>(mapPath(q));
    const totalAnyDate = page.pagination?.totalAnyDate;
    return {
      deals: page.data,
      clients: page.included?.clients ?? [],
      technicians: page.included?.technicians ?? [],
      ...(typeof totalAnyDate === "number" && { totalAnyDate }),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return drainDispatchJobs(q);
    throw error;
  }
}

/**
 * The old read, for a deal-service without `/deals/map`: every page of the
 * jobs list for the window (`windowRequests`), then the clients by id. A
 * failed clients request costs their names, never the jobs.
 */
async function drainDispatchJobs(q: DispatchMapQuery): Promise<DispatchJobs> {
  // A window with no statuses is the open ones' days — never every status of those days.
  const statuses = q.from && !q.statuses?.length ? OPEN_STATUSES : q.statuses;
  const window = q.from ? { from: q.from, to: q.to ?? q.from, statuses } : { statuses: q.statuses };
  const pages = await Promise.all(windowRequests(window).map((req) => fetchAllDeals(req)));
  const seen = new Set<string>();
  const deals: Deal[] = [];
  for (const d of pages.flat()) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    deals.push(d);
  }
  const ids = [...new Set(deals.map((d) => d.contactId).filter(Boolean))];
  const contacts = ids.length ? await getContactsByIds(ids).catch(() => [] as Contact[]) : [];
  return { deals, clients: (contacts ?? []).map(asMapClient), technicians: null };
}
