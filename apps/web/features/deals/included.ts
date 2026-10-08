import type { JobsListIncluded, PersonName, TechnicianName } from "@bitcrm/types";

/**
 * The names a loaded jobs list refers to, as lookups.
 *
 * `technicians` is keyed by user id, `clients` by contact id. A technician
 * imported from Workiz also carries the name Workiz prints for them
 * (`workizName`, "(2) TX - Daniel Munoz") — `personName` prefers it.
 *
 * **Names only.** The side-load carries exactly `{ id, firstName, lastName }`
 * (+ a technician's `workizName`) by design: crm masks a contact's numbers for a caller without
 * `contacts.view_numbers` and deal-service masks nothing, so a number that
 * travelled with the rows would hand every holder of `deals.view` what that
 * grant exists to withhold. A column that shows a number asks crm for the
 * contact, exactly as it always has.
 */
export interface JobsListNames {
  technicians: Map<string, TechnicianName>;
  clients: Map<string, PersonName>;
}

/**
 * One lookup for every page the pager is holding.
 *
 * The server sends `included` with each page, and the pager keeps several
 * pages in hand at once — so a row is named from whichever page carried the
 * name, not only from its own.
 *
 * A page may name nobody (an empty list, or a deploy that predates the
 * side-load), and a technician may be missing from a page that does: the
 * names come from deal-service's eligibility projection, and somebody it has
 * not reconciled yet simply has no row. Both answer `undefined` here, which
 * every caller renders as "still waiting" rather than as a raw uuid.
 */
export function mergeIncluded(
  pages: readonly { included?: JobsListIncluded }[] | undefined,
): JobsListNames {
  const technicians = new Map<string, TechnicianName>();
  const clients = new Map<string, PersonName>();
  for (const page of pages ?? []) {
    for (const t of page.included?.technicians ?? []) technicians.set(t.id, t);
    for (const c of page.included?.clients ?? []) clients.set(c.id, c);
  }
  return { technicians, clients };
}
