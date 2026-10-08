import { DealStatus } from "@bitcrm/types";
import type { Contact, Deal, PersonName } from "@bitcrm/types";
import { matchesTab, sortJobs } from "./lib";
import type { JobsListState, JobsSort } from "./query-params";

/**
 * The jobs page's Search box, the Workiz way (jobslist notes, probed live):
 * server-side, inside the tab and the filters, matching the client's name,
 * a piece of the job ID, phone digits in any format, the address, the job
 * type, the email and the company — never the technician or the tags.
 *
 * Until `GET /deals` takes free text (`JobsListCaps.textSearch`), the search
 * service finds the candidates across every job and these functions decide
 * which of them the list shows: the engine is fuzzy and prefix-based
 * ("Dustin" also finds Austin), Workiz is not.
 */

export interface JobSearchContext {
  /** The client record, when crm answered for it — names, phones, emails. */
  contact?: Contact;
  /** The name that came with the row (`included.clients`). */
  sideloadedName?: PersonName;
  jobTypeName: (id?: string) => string;
}

/** A query made only of digits and phone punctuation. */
const PHONE_SHAPED = /^[\d\s().+\-–—]+$/;

const has = (value: string | undefined, q: string) => !!value && value.toLowerCase().includes(q);

export function matchesJobSearch(deal: Deal, text: string, ctx: JobSearchContext): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;

  const names = [
    deal.clientName ? `${deal.clientName.firstName} ${deal.clientName.lastName}` : "",
    ctx.contact ? `${ctx.contact.firstName} ${ctx.contact.lastName}` : "",
    ctx.sideloadedName ? `${ctx.sideloadedName.firstName ?? ""} ${ctx.sideloadedName.lastName ?? ""}` : "",
  ];
  if (names.some((n) => has(n.replace(/\s+/g, " ").trim(), q))) return true;

  const code = q.replace(/[^a-z0-9]/g, "");
  if (code && String(deal.dealNumber).toLowerCase().includes(code)) return true;

  const digits = PHONE_SHAPED.test(q) ? q.replace(/\D/g, "") : "";
  if (digits.length >= 4) {
    const phones = ctx.contact?.phones ?? [];
    if (phones.some((p) => p.replace(/\D/g, "").includes(digits))) return true;
  }

  const a = deal.address;
  if ([a?.street, a?.city, a?.state, a?.zip].some((v) => has(v, q))) return true;
  if (has(ctx.jobTypeName(deal.jobTypeId), q)) return true;
  if (has(deal.jobName, q)) return true;
  if (has(deal.serviceArea, q)) return true;
  if (has(deal.emailAddress, q) || (ctx.contact?.emails ?? []).some((e) => has(e, q))) return true;
  if (has(deal.clientCompanyName, q)) return true;
  return false;
}

/**
 * Money still owed — deal-service's `hasBalanceDue` (`deal-balance.ts`), the
 * rule behind `unpaid=true`, so a search hit is judged as the list would be.
 */
export function hasBalanceDue(deal: Pick<Deal, "totals" | "amountPaid" | "paymentStatus">): boolean {
  const total = deal.totals?.total;
  if (typeof total !== "number" || !(total > 0)) return false;
  if (typeof deal.amountPaid === "number") return total > deal.amountPaid;
  const workizDue = deal.totals?.amountDue;
  if (typeof workizDue === "number") return workizDue > 0;
  return deal.paymentStatus !== "paid";
}

/** Does a found job belong on the page — its tab, then every group (OR inside, AND across)? */
export function matchesListState(deal: Deal, state: JobsListState): boolean {
  if (deal.status !== DealStatus.ACTIVE) return false;
  if (state.unpaid && !hasBalanceDue(deal)) return false;
  if (!matchesTab(deal, state.tab)) return false;
  const any = (wanted: string[], has: (v: string) => boolean) => !wanted.length || wanted.some(has);
  if (!any(state.techIds, (t) => deal.assignedTechIds.includes(t))) return false;
  if (!any(state.tagIds, (t) => deal.tagIds.includes(t))) return false;
  if (!any(state.jobTypeIds, (t) => deal.jobTypeId === t)) return false;
  if (!any(state.serviceAreas, (a) => deal.serviceArea === a)) return false;
  if (!any(state.businessProfileIds, (b) => deal.businessProfileId === b)) return false;
  if (state.dateFrom) {
    const day = deal.scheduledDate;
    const to = state.dateTo || state.dateFrom;
    if (!day || day < state.dateFrom || day > to) return false;
  }
  if (state.hourFrom || state.hourTo) {
    const start = deal.scheduledTimeSlot?.split("-")[0]?.trim();
    if (!deal.scheduledDate || !start) return false;
    if (state.hourFrom && start < state.hourFrom) return false;
    if (state.hourTo && start > state.hourTo) return false;
  }
  return true;
}

/** The deal ids of a search answer, once each, in the engine's order. */
export function searchHitIds(hits: { entityId: string; type: string }[]): string[] {
  const out: string[] = [];
  for (const h of hits) if (h.type === "deal" && !out.includes(h.entityId)) out.push(h.entityId);
  return out;
}

/** Found jobs read in the list's order: by visit (soonest first unless asked otherwise), undated last. */
export function orderSearchResults(deals: Deal[], sort: JobsSort): Deal[] {
  if (sort === "hour_asc" || sort === "hour_desc") {
    return sortJobs(deals, { key: "hour", dir: sort === "hour_asc" ? "asc" : "desc" });
  }
  return sortJobs(deals, { key: "schedule", dir: sort === "day_desc" ? "desc" : "asc" });
}
