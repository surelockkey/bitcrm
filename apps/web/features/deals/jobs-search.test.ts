import { describe, expect, it } from "vitest";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";
import { matchesJobSearch, matchesListState, orderSearchResults, searchHitIds } from "./jobs-search";
import { EMPTY_JOBS_LIST_STATE, type JobsListState } from "./query-params";

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: "d1",
  dealNumber: "5TU7ZA",
  contactId: "c1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "SURE LOCK DALLAS TX",
  address: { street: "12 Elm St", city: "Princeton", state: "Texas", zip: "75407" },
  jobTypeId: "jt-service",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u1",
  priority: DealPriority.NORMAL,
  assignedTechIds: ["t1"],
  tagIds: ["g1"],
  scheduledDate: "2026-10-08",
  scheduledTimeSlot: "08:00-09:00",
  status: DealStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

const contact: Contact = {
  id: "c1",
  firstName: "Dustin",
  lastName: "Roselle",
  phones: ["+14693968179"],
  emails: ["dustin@example.com"],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const ctx = {
  contact,
  jobTypeName: (id?: string) => (id === "jt-service" ? "Service" : ""),
  tagName: (id: string) => (id === "g1" ? "Needs a call" : id),
  techName: (id: string) => (id === "t1" ? "(2) TX - Daniel Munoz" : id),
};

/**
 * What Workiz's Search box matched in the live probe (jobslist notes):
 * "dust", "roselle", "5TU7", "8179", "469 396", "Princeton", "Service" all
 * found 5TU7ZA; "TX - Daniel" (its tech) and "needs a call" (its tag) did not.
 */
describe("matchesJobSearch — Workiz's matching rules", () => {
  it("finds the client by first, last or full name, any case", () => {
    for (const q of ["dust", "Roselle", "DUSTIN ROSELLE"]) expect(matchesJobSearch(deal(), q, ctx), q).toBe(true);
  });

  it("finds the job by a piece of its ID", () => {
    expect(matchesJobSearch(deal(), "5TU7", ctx)).toBe(true);
    expect(matchesJobSearch(deal(), "5tu7za", ctx)).toBe(true);
  });

  it("finds the phone by its digits, formatted or not", () => {
    for (const q of ["8179", "469 396", "(469) 396-8179", "4693968179"]) expect(matchesJobSearch(deal(), q, ctx), q).toBe(true);
    expect(matchesJobSearch(deal(), "5555", ctx)).toBe(false);
  });

  it("finds the city, the street, the zip and the job type", () => {
    for (const q of ["princeton", "Elm St", "75407", "Service"]) expect(matchesJobSearch(deal(), q, ctx), q).toBe(true);
  });

  it("finds the job by its name", () => {
    expect(matchesJobSearch(deal({ jobName: "Mailbox lock" }), "mailbox", ctx)).toBe(true);
  });

  it("finds the email and the company the job carries", () => {
    expect(matchesJobSearch(deal(), "dustin@ex", ctx)).toBe(true);
    expect(matchesJobSearch(deal({ clientCompanyName: "The City of Aurora" }), "aurora", ctx)).toBe(true);
  });

  it("does not match the technician or the tags, as Workiz does not", () => {
    expect(matchesJobSearch(deal(), "TX - Daniel", ctx)).toBe(false);
    expect(matchesJobSearch(deal(), "needs a call", ctx)).toBe(false);
  });

  it("does not take a near miss — the search service is fuzzy, the list is not", () => {
    // OpenSearch's fuzziness finds "Austin" for "Dustin"; Workiz would not.
    expect(matchesJobSearch(deal({ address: { street: "1 Main", city: "Austin", state: "Texas", zip: "73301" } }), "Dustin", {
      ...ctx,
      contact: { ...contact, firstName: "Ann", lastName: "Lee", emails: [] },
    })).toBe(false);
  });

  it("uses the job's own name override, and the side-loaded name when no contact is in hand", () => {
    expect(matchesJobSearch(deal({ clientName: { firstName: "Ivan", lastName: "Koval" } }), "koval", ctx)).toBe(true);
    expect(
      matchesJobSearch(deal(), "jane", { ...ctx, contact: undefined, sideloadedName: { id: "c1", firstName: "Jane", lastName: "Smith" } }),
    ).toBe(true);
  });

  it("an empty query matches everything", () => {
    expect(matchesJobSearch(deal(), "   ", ctx)).toBe(true);
  });
});

describe("matchesListState — a search hit still has to be on the tab and pass the filters", () => {
  const base: JobsListState = { ...EMPTY_JOBS_LIST_STATE };

  it("keeps only the tab's status; Unscheduled means no visit date", () => {
    expect(matchesListState(deal(), base)).toBe(true);
    expect(matchesListState(deal({ superStatus: JobSuperStatus.PENDING }), base)).toBe(false);
    expect(matchesListState(deal({ scheduledDate: undefined }), { ...base, tab: "unscheduled" })).toBe(true);
    expect(matchesListState(deal(), { ...base, tab: "unscheduled" })).toBe(false);
  });

  it("OR inside a group, AND across groups", () => {
    const d = deal({ assignedTechIds: ["t2"], tagIds: ["g9"] });
    expect(matchesListState(d, { ...base, techIds: ["t1", "t2"] })).toBe(true);
    expect(matchesListState(d, { ...base, techIds: ["t1"] })).toBe(false);
    expect(matchesListState(d, { ...base, techIds: ["t2"], tagIds: ["g1"] })).toBe(false);
    expect(matchesListState(d, { ...base, techIds: ["t2"], tagIds: ["g1", "g9"] })).toBe(true);
  });

  it("job type, area and company", () => {
    const d = deal({ businessProfileId: "bp2" });
    expect(matchesListState(d, { ...base, jobTypeIds: ["jt-service"] })).toBe(true);
    expect(matchesListState(d, { ...base, jobTypeIds: ["other"] })).toBe(false);
    expect(matchesListState(d, { ...base, serviceAreas: ["SURE LOCK DALLAS TX"] })).toBe(true);
    expect(matchesListState(d, { ...base, serviceAreas: ["SURE LOCK CT"] })).toBe(false);
    expect(matchesListState(d, { ...base, businessProfileIds: ["bp2"] })).toBe(true);
    expect(matchesListState(d, { ...base, businessProfileIds: ["bp1"] })).toBe(false);
  });

  it("the day window and the hours", () => {
    expect(matchesListState(deal(), { ...base, dateFrom: "2026-10-08" })).toBe(true);
    expect(matchesListState(deal(), { ...base, dateFrom: "2026-10-09", dateTo: "2026-10-10" })).toBe(false);
    expect(matchesListState(deal(), { ...base, hourFrom: "08:00", hourTo: "08:30" })).toBe(true);
    expect(matchesListState(deal(), { ...base, hourFrom: "09:00" })).toBe(false);
    expect(matchesListState(deal({ scheduledDate: undefined }), { ...base, dateFrom: "2026-10-08" })).toBe(false);
  });

  /**
   * The search service knows nothing of balances, so "Show unpaid jobs" is
   * applied to its hits here — by the same rule deal-service's `unpaid=true`
   * uses (`deal-balance.ts`).
   */
  it("Show unpaid jobs keeps only jobs with money still owed", () => {
    const unpaid = { ...base, unpaid: true };
    const totals = (total: number, amountDue?: number) => ({ subtotal: total, discount: 0, tax: 0, total, cost: 0, amountDue });
    expect(matchesListState(deal(), unpaid)).toBe(false); // nothing to pay
    expect(matchesListState(deal({ totals: totals(100), amountPaid: 40 }), unpaid)).toBe(true);
    expect(matchesListState(deal({ totals: totals(100), amountPaid: 100 }), unpaid)).toBe(false);
    expect(matchesListState(deal({ totals: totals(100, 25) }), unpaid)).toBe(true);
    expect(matchesListState(deal({ totals: totals(100, 0) }), unpaid)).toBe(false);
    expect(matchesListState(deal({ totals: totals(100), paymentStatus: "paid" }), unpaid)).toBe(false);
    expect(matchesListState(deal({ totals: totals(100) }), unpaid)).toBe(true);
    // Off, it narrows nothing.
    expect(matchesListState(deal(), base)).toBe(true);
  });

  it("drops a deleted job", () => {
    expect(matchesListState(deal({ status: DealStatus.DELETED }), base)).toBe(false);
  });
});

describe("searchHitIds", () => {
  it("keeps the deal hits, once each, in the engine's order", () => {
    expect(
      searchHitIds([
        { entityId: "a", type: "deal" },
        { entityId: "c", type: "contact" },
        { entityId: "b", type: "deal" },
        { entityId: "a", type: "deal" },
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("orderSearchResults — found jobs read in the list's own order", () => {
  const a = deal({ id: "a", scheduledDate: "2026-10-09", scheduledTimeSlot: "07:00-08:00" });
  const b = deal({ id: "b", scheduledDate: "2026-10-08", scheduledTimeSlot: "15:00-16:00" });
  const c = deal({ id: "c", scheduledDate: undefined, scheduledTimeSlot: undefined });

  it("soonest visit first, undated last", () => {
    expect(orderSearchResults([c, a, b], "none").map((d) => d.id)).toEqual(["b", "a", "c"]);
  });

  it("latest day first when asked", () => {
    expect(orderSearchResults([c, b, a], "day_desc").map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("by the hour of the day when asked", () => {
    expect(orderSearchResults([b, a], "hour_asc").map((d) => d.id)).toEqual(["a", "b"]);
  });
});
