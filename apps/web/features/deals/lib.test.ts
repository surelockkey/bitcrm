import { describe, it, expect } from "vitest";
import {
  JobSuperStatus,
  DealPriority,
  DealStatus,
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
} from "@bitcrm/types";
import type { Address, Contact, CustomFieldDefinition, Deal, DealProduct } from "@bitcrm/types";
import {
  superStatusLabel,
  groupLabel,
  isTerminalStatus,
  priorityLabel,
  isUrgent,
  formatMoney,
  dealTotal,
  priceRange,
  isPriceInBand,
  filterDeals,
  datePresetRange,
  scheduleRelative,
  JOB_TABS,
  jobTabLabel,
  matchesTab,
  tabCounts,
  dealDraftFromDeal,
  buildDealPatch,
  clientDraftFromContact,
  buildContactBody,
  sortJobs,
  jobDayKey,
  jobHourKey,
  dealClientName,
} from "./lib";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "1042",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-lockout",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: [],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function cfDef(over: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: "cf-1",
    name: "Gate Code",
    type: "text",
    group: "Access",
    jobTypeIds: [],
    required: false,
    requiredToClose: false,
    searchable: true,
    priority: 0,
    active: true,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function product(over: Partial<DealProduct> = {}): DealProduct {
  return {
    productId: "p1",
    name: "Deadbolt",
    sku: "LOCK-1",
    quantity: 1,
    costCompany: 10,
    costForTech: 18,
    priceClient: 45,
    addedBy: "u1",
    addedAt: "",
    ...over,
  };
}

describe("super-status helpers", () => {
  it("labels super-statuses", () => {
    expect(superStatusLabel(JobSuperStatus.SUBMITTED)).toBe("Submitted");
    expect(superStatusLabel(JobSuperStatus.IN_PROGRESS)).toBe("In Progress");
    expect(superStatusLabel(JobSuperStatus.DONE_PENDING_APPROVAL)).toBe("Done Pending Approval");
  });
  it("groupLabel aliases the super-status labels", () => {
    expect(groupLabel(JobSuperStatus.PENDING)).toBe("Pending");
    expect(groupLabel(JobSuperStatus.CANCELED)).toBe("Canceled");
  });
  it("knows terminal super-statuses", () => {
    expect(isTerminalStatus(JobSuperStatus.DONE)).toBe(true);
    expect(isTerminalStatus(JobSuperStatus.DONE_PENDING_APPROVAL)).toBe(true);
    expect(isTerminalStatus(JobSuperStatus.CANCELED)).toBe(true);
    expect(isTerminalStatus(JobSuperStatus.IN_PROGRESS)).toBe(false);
  });
});

describe("labels", () => {
  it("labels priority + urgency", () => {
    expect(priorityLabel(DealPriority.URGENT)).toBe("Urgent");
    expect(isUrgent(deal({ priority: DealPriority.URGENT }))).toBe(true);
    expect(isUrgent(deal())).toBe(false);
  });
});

describe("money", () => {
  it("formats dollars", () => {
    expect(formatMoney(140)).toBe("$140.00");
    expect(formatMoney(45.5)).toBe("$45.50");
  });
  it("sums line items", () => {
    expect(dealTotal([product({ quantity: 2, priceClient: 45 }), product({ priceClient: 95 })])).toBe(185);
    expect(dealTotal([])).toBe(0);
  });
});

describe("price band (±15%)", () => {
  it("computes the allowed range off catalog price", () => {
    const r = priceRange(45);
    expect(r.min).toBeCloseTo(38.25, 2);
    expect(r.max).toBeCloseTo(51.75, 2);
  });
  it("validates a price against the band", () => {
    expect(isPriceInBand(45, 45)).toBe(true);
    expect(isPriceInBand(50, 45)).toBe(true);
    expect(isPriceInBand(52, 45)).toBe(false);
    expect(isPriceInBand(38, 45)).toBe(false);
  });
});

describe("filterDeals", () => {
  const contacts = new Map<string, Contact>([
    ["c1", contact({ id: "c1", firstName: "Jane", lastName: "Smith", phones: ["(292) 839-8283"], emails: ["jane@example.com"] })],
    ["c2", contact({ id: "c2", firstName: "Marcus", lastName: "Reyes", phones: ["404-555-0177"], emails: [] })],
  ]);
  const list = [
    deal({ id: "a", dealNumber: "1042", contactId: "c1", superStatus: JobSuperStatus.SUBMITTED, priority: DealPriority.URGENT, jobTypeId: "jt-lockout" }),
    deal({ id: "b", dealNumber: "1040", contactId: "c2", superStatus: JobSuperStatus.IN_PROGRESS, jobTypeId: "jt-rekey", assignedTechIds: ["t9"] }),
  ];
  it("returns all with no filters", () => {
    expect(filterDeals(list, {}, contacts)).toHaveLength(2);
  });
  it("filters by super-status and priority", () => {
    expect(filterDeals(list, { superStatus: JobSuperStatus.SUBMITTED }, contacts).map((d) => d.id)).toEqual(["a"]);
    expect(filterDeals(list, { priority: DealPriority.URGENT }, contacts).map((d) => d.id)).toEqual(["a"]);
  });
  it("searches by deal number and client name", () => {
    expect(filterDeals(list, { search: "1040" }, contacts).map((d) => d.id)).toEqual(["b"]);
    expect(filterDeals(list, { search: "jane" }, contacts).map((d) => d.id)).toEqual(["a"]);
    expect(filterDeals(list, { search: "#1042" }, contacts).map((d) => d.id)).toEqual(["a"]);
  });

  it("finds the job by its client's phone in every format users type", () => {
    for (const q of [
      "2928398283", // collapsed
      "(292) 839-8283", // as stored
      "292 839 8283", // different separators
      "+1 292 839 8283", // country code the contact was stored without
      "839-8283", // formatted tail
      "8398283", // collapsed tail
      "398283", // middle fragment
      "8283", // last four
    ]) {
      expect(filterDeals(list, { search: q }, contacts).map((d) => d.id), q).toEqual(["a"]);
    }
  });

  it("does not phone-match digits that are not in any phone", () => {
    expect(filterDeals(list, { search: "9999" }, contacts)).toHaveLength(0);
  });

  it("finds the job by its client's email", () => {
    expect(filterDeals(list, { search: "jane@example" }, contacts).map((d) => d.id)).toEqual(["a"]);
  });

  it("finds the job by its per-job client-name override as well as the contact name", () => {
    const rows = [
      deal({ id: "o", contactId: "c1", clientName: { firstName: "Janet", lastName: "Poole" } }),
    ];
    expect(filterDeals(rows, { search: "poole" }, contacts).map((d) => d.id)).toEqual(["o"]);
    // The underlying contact's name still matches too.
    expect(filterDeals(rows, { search: "jane smith" }, contacts).map((d) => d.id)).toEqual(["o"]);
  });

  it("matches a phone fragment inside a searchable custom-field value", () => {
    const defs = [cfDef({ id: "cf-alt", searchable: true })];
    const rows = [
      deal({ id: "p", contactId: "c2", customFields: { "cf-alt": "(555) 010-2233" } }),
    ];
    expect(filterDeals(rows, { search: "0102233" }, contacts, defs).map((d) => d.id)).toEqual(["p"]);
    expect(filterDeals(rows, { search: "555 010 2233" }, contacts, defs).map((d) => d.id)).toEqual(["p"]);
  });

  it("searches by random job id code, case-insensitively and with # prefix", () => {
    const codes = [
      deal({ id: "x", dealNumber: "K4T9ZW", contactId: "c1" }),
      deal({ id: "y", dealNumber: "X7B2QP", contactId: "c2" }),
    ];
    expect(filterDeals(codes, { search: "k4t9" }, contacts).map((d) => d.id)).toEqual(["x"]);
    expect(filterDeals(codes, { search: "#X7B2QP" }, contacts).map((d) => d.id)).toEqual(["y"]);
    expect(filterDeals(codes, { search: "x7b2qp" }, contacts).map((d) => d.id)).toEqual(["y"]);
  });

  it("matches the string form of a searchable custom-field value", () => {
    const defs = [cfDef({ id: "cf-gate", searchable: true })];
    const withCf = [
      deal({ id: "g", contactId: "c1", customFields: { "cf-gate": "Ring twice #4471" } }),
      deal({ id: "h", contactId: "c2" }),
    ];
    expect(
      filterDeals(withCf, { search: "4471" }, contacts, defs).map((d) => d.id),
    ).toEqual(["g"]);
    // Array (multi_select) values match on any member.
    const multi = [
      deal({ id: "m", contactId: "c1", customFields: { "cf-gate": ["North Gate", "Loading Dock"] } }),
    ];
    expect(
      filterDeals(multi, { search: "loading" }, contacts, [cfDef({ id: "cf-gate", type: "multi_select", searchable: true })]).map((d) => d.id),
    ).toEqual(["m"]);
  });

  it("does NOT match a custom-field value on a non-searchable definition", () => {
    const defs = [cfDef({ id: "cf-gate", searchable: false })];
    const withCf = [
      deal({ id: "g", contactId: "c1", customFields: { "cf-gate": "Ring twice #4471" } }),
    ];
    expect(filterDeals(withCf, { search: "4471" }, contacts, defs)).toHaveLength(0);
  });

  it("filters by service area (exact)", () => {
    const areas = [
      deal({ id: "atl", serviceArea: "Atlanta Metro" }),
      deal({ id: "nga", serviceArea: "North GA" }),
    ];
    expect(filterDeals(areas, { serviceArea: "North GA" }, contacts).map((d) => d.id)).toEqual(["nga"]);
  });

  it("filters by status group", () => {
    // a = Submitted, b = In Progress
    expect(
      filterDeals(list, { statusGroups: [JobSuperStatus.SUBMITTED] }, contacts).map((d) => d.id),
    ).toEqual(["a"]);
    expect(filterDeals(list, { statusGroups: [] }, contacts)).toHaveLength(2);
  });

  it("datePresetRange maps presets to ranges", () => {
    expect(datePresetRange("all", "2026-07-16")).toEqual({});
    expect(datePresetRange("today", "2026-07-16")).toEqual({ from: "2026-07-16", to: "2026-07-16" });
    // 2026-07-16 is a Thursday → week is Mon 13th … Sun 19th
    expect(datePresetRange("week", "2026-07-16")).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });

  it("filters by scheduled-date range and excludes undated deals", () => {
    const dated = [
      deal({ id: "mon", scheduledDate: "2026-07-13" }),
      deal({ id: "wed", scheduledDate: "2026-07-15" }),
      deal({ id: "none" }),
    ];
    expect(
      filterDeals(dated, { dateFrom: "2026-07-14", dateTo: "2026-07-16" }, contacts).map((d) => d.id),
    ).toEqual(["wed"]);
  });
});

describe("status tabs", () => {
  const contacts = new Map<string, Contact>();
  it("orders the 6 super-statuses then unscheduled, and labels them", () => {
    expect(JOB_TABS).toEqual([
      JobSuperStatus.SUBMITTED,
      JobSuperStatus.IN_PROGRESS,
      JobSuperStatus.DONE,
      JobSuperStatus.PENDING,
      JobSuperStatus.DONE_PENDING_APPROVAL,
      JobSuperStatus.CANCELED,
      "unscheduled",
    ]);
    expect(jobTabLabel(JobSuperStatus.IN_PROGRESS)).toBe("In Progress");
    expect(jobTabLabel("unscheduled")).toBe("Unscheduled");
  });

  it("matchesTab: super-status by status, unscheduled by missing date", () => {
    const submittedDated = deal({ superStatus: JobSuperStatus.SUBMITTED, scheduledDate: "2026-07-13" });
    const submittedUndated = deal({ superStatus: JobSuperStatus.SUBMITTED });
    expect(matchesTab(submittedDated, JobSuperStatus.SUBMITTED)).toBe(true);
    expect(matchesTab(submittedDated, "unscheduled")).toBe(false);
    expect(matchesTab(submittedUndated, "unscheduled")).toBe(true);
    // Unscheduled overlaps its status tab — a deal can appear in both.
    expect(matchesTab(submittedUndated, JobSuperStatus.SUBMITTED)).toBe(true);
  });

  it("tabCounts counts each tab independently (overlapping)", () => {
    const list = [
      deal({ superStatus: JobSuperStatus.SUBMITTED, scheduledDate: "2026-07-13" }), // submitted, scheduled
      deal({ superStatus: JobSuperStatus.SUBMITTED }), // submitted, unscheduled
      deal({ superStatus: JobSuperStatus.IN_PROGRESS, scheduledDate: "2026-07-14" }), // in progress
      deal({ superStatus: JobSuperStatus.DONE }), // done, unscheduled
    ];
    const c = tabCounts(list);
    expect(c[JobSuperStatus.SUBMITTED]).toBe(2);
    expect(c[JobSuperStatus.IN_PROGRESS]).toBe(1);
    expect(c[JobSuperStatus.DONE]).toBe(1);
    expect(c.unscheduled).toBe(2);
  });

  it("scheduleRelative labels dates relative to today", () => {
    expect(scheduleRelative(undefined, "2026-07-16")).toBeNull();
    expect(scheduleRelative("2026-07-16", "2026-07-16")).toEqual({ label: "Today", tone: "soon" });
    expect(scheduleRelative("2026-07-17", "2026-07-16")).toEqual({ label: "Tomorrow", tone: "ok" });
    expect(scheduleRelative("2026-07-19", "2026-07-16")).toEqual({ label: "in 3 days", tone: "ok" });
    expect(scheduleRelative("2026-07-14", "2026-07-16")).toEqual({ label: "2 days ago", tone: "overdue" });
    expect(scheduleRelative("2026-07-15", "2026-07-16")).toEqual({ label: "1 day ago", tone: "overdue" });
  });

  it("filterDeals honors a single tab", () => {
    const list = [
      deal({ id: "a", superStatus: JobSuperStatus.SUBMITTED, scheduledDate: "2026-07-13" }),
      deal({ id: "b", superStatus: JobSuperStatus.IN_PROGRESS }),
    ];
    expect(filterDeals(list, { tab: JobSuperStatus.SUBMITTED }, contacts).map((d) => d.id)).toEqual(["a"]);
    expect(filterDeals(list, { tab: "unscheduled" }, contacts).map((d) => d.id)).toEqual(["b"]);
  });
});

/* ------------------- single-save drafts (one Save button on the job page) --- */

// Imported with their real signatures so these cases type-check the actual
// UpdateDealValues / UpdateContactValues shapes, not a loosened stand-in.

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    firstName: "Jane",
    lastName: "Smith",
    phones: ["+14045551234"],
    emails: ["jane@example.com", "billing@example.com"],
    addresses: [{ street: "1 Main St", city: "Phoenix", state: "AZ", zip: "85001" }],
    companyId: "co1",
    type: ContactType.COMPANY_REPRESENTATIVE,
    title: "Office manager",
    source: ContactSource.PHONE_CALL,
    notes: "VIP",
    status: CrmStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("buildDealPatch", () => {
  it("returns null for a clean draft (sparse and fully-populated deals)", () => {
    const sparse = deal();
    expect(buildDealPatch(sparse, dealDraftFromDeal(sparse))).toBeNull();

    const full = deal({
      poNumber: "PO-1",
      workOrderId: "wo-1",
      sourceId: "src-1",
      externalCompanyId: "ec-1",
      scheduledDate: "2026-08-01",
      scheduledTimeSlot: "08:00-10:00",
      notes: "hello",
      internalNotes: "internal",
    });
    expect(buildDealPatch(full, dealDraftFromDeal(full))).toBeNull();
  });

  it("sends the external company as a changed key, and clears it when emptied", () => {
    const d = deal();
    const set = buildDealPatch(d, { ...dealDraftFromDeal(d), externalCompanyId: "ec-1" });
    expect(Object.keys(set!)).toEqual(["externalCompanyId"]);
    expect(set!.externalCompanyId).toBe("ec-1");

    // Clearing must send an explicit null: `undefined` is dropped by
    // JSON.stringify, so the PUT body would omit the key and the backend
    // would leave the old company attached.
    const had = deal({ externalCompanyId: "ec-1" });
    const cleared = buildDealPatch(had, { ...dealDraftFromDeal(had), externalCompanyId: "" });
    expect(Object.keys(cleared!)).toEqual(["externalCompanyId"]);
    expect(cleared!.externalCompanyId).toBeNull();
    expect(JSON.parse(JSON.stringify(cleared))).toEqual({ externalCompanyId: null });
  });

  it("returns only the changed key", () => {
    const d = deal();
    const patch = buildDealPatch(d, { ...dealDraftFromDeal(d), serviceArea: "North GA" });
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!)).toEqual(["serviceArea"]);
    expect(patch!.serviceArea).toBe("North GA");
  });

  it("clears an emptied optional field with undefined (today's commit semantics)", () => {
    const d = deal({ poNumber: "PO-1" });
    const patch = buildDealPatch(d, { ...dealDraftFromDeal(d), poNumber: "" });
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!)).toEqual(["poNumber"]);
    expect(patch!.poNumber).toBeUndefined();
  });

  it("treats empty draft values over absent optional fields as clean", () => {
    const d = deal(); // no poNumber / sourceId / scheduledDate
    expect(
      buildDealPatch(d, { ...dealDraftFromDeal(d), poNumber: "", sourceId: "", scheduledDate: "" }),
    ).toBeNull();
  });

  it("trims notes and ignores whitespace-only changes", () => {
    const d = deal({ notes: "hello" });
    expect(buildDealPatch(d, { ...dealDraftFromDeal(d), notes: "  hello  " })).toBeNull();

    const patch = buildDealPatch(d, { ...dealDraftFromDeal(d), notes: "  changed  " });
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!)).toEqual(["notes"]);
    expect(patch!.notes).toBe("changed");
  });
});

describe("custom fields (single-save draft)", () => {
  it("dealDraftFromDeal copies the deal's customFields into a fresh map", () => {
    const d = deal({ customFields: { "cf-a": "x", "cf-n": 2, "cf-m": ["A", "B"] } });
    const draft = dealDraftFromDeal(d);
    expect(draft.customFields).toEqual({ "cf-a": "x", "cf-n": 2, "cf-m": ["A", "B"] });
    // A fresh object — mutating the draft must not touch the deal.
    expect(draft.customFields).not.toBe(d.customFields);
  });

  it("dealDraftFromDeal defaults customFields to {} when the deal has none", () => {
    expect(dealDraftFromDeal(deal()).customFields).toEqual({});
  });

  it("is clean when the customFields answers are unchanged (round-trip)", () => {
    const d = deal({ customFields: { "cf-a": "x", "cf-m": ["A", "B"] } });
    expect(buildDealPatch(d, dealDraftFromDeal(d))).toBeNull();
  });

  it("emits a customFields patch keyed only on customFields when one answer changes", () => {
    const d = deal({ customFields: { "cf-a": "x", "cf-n": 1 } });
    const patch = buildDealPatch(d, {
      ...dealDraftFromDeal(d),
      customFields: { "cf-a": "y", "cf-n": 1 },
    });
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!)).toEqual(["customFields"]);
    expect(patch!.customFields).toEqual({ "cf-a": "y", "cf-n": 1 });
  });

  it("emits customFields when an answer is added to a deal that had none", () => {
    const d = deal();
    const patch = buildDealPatch(d, {
      ...dealDraftFromDeal(d),
      customFields: { "cf-new": true },
    });
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!)).toEqual(["customFields"]);
    expect(patch!.customFields).toEqual({ "cf-new": true });
  });

  it("emits an empty customFields map when the last answer is cleared", () => {
    const d = deal({ customFields: { "cf-a": "x" } });
    const patch = buildDealPatch(d, { ...dealDraftFromDeal(d), customFields: {} });
    expect(patch).not.toBeNull();
    expect(Object.keys(patch!)).toEqual(["customFields"]);
    expect(patch!.customFields).toEqual({});
  });

  it("treats identical array answers as clean but a reordered/extended array as changed", () => {
    const d = deal({ customFields: { "cf-m": ["A", "B"] } });
    expect(buildDealPatch(d, dealDraftFromDeal(d))).toBeNull();

    const patch = buildDealPatch(d, {
      ...dealDraftFromDeal(d),
      customFields: { "cf-m": ["A", "B", "C"] },
    });
    expect(patch!.customFields).toEqual({ "cf-m": ["A", "B", "C"] });
  });

  it("keeps customFields out of the patch when only a plain field changed", () => {
    const d = deal({ customFields: { "cf-a": "x" } });
    const patch = buildDealPatch(d, { ...dealDraftFromDeal(d), serviceArea: "North GA" });
    expect(Object.keys(patch!)).toEqual(["serviceArea"]);
  });
});

describe("dealClientName", () => {
  it("prefers the per-job override and falls back to the contact", () => {
    const c = contact();
    expect(dealClientName(deal(), c)).toBe("Jane Smith");
    expect(
      dealClientName(deal({ clientName: { firstName: "Janet", lastName: "Poole" } }), c),
    ).toBe("Janet Poole");
    expect(dealClientName(deal(), undefined)).toBe("—");
  });
});

describe("buildContactBody", () => {
  it("returns null when nothing changed and there is no new address", () => {
    const c = contact();
    expect(buildContactBody(c, clientDraftFromContact(c))).toBeNull();
  });

  it("returns the full body on a name change, preserving company/type/title/notes and extra emails", () => {
    const c = contact();
    const body = buildContactBody(c, { ...clientDraftFromContact(c), firstName: "Janet" });
    expect(body).toEqual({
      firstName: "Janet",
      lastName: "Smith",
      phones: ["+14045551234"],
      emails: ["jane@example.com", "billing@example.com"],
      addresses: c.addresses,
      companyId: "co1",
      type: ContactType.COMPANY_REPRESENTATIVE,
      title: "Office manager",
      notes: "VIP",
    });
  });

  it("replaces only the first email, keeping the rest", () => {
    const c = contact();
    const body = buildContactBody(c, { ...clientDraftFromContact(c), email: "new@example.com" });
    expect(body).not.toBeNull();
    expect(body!.emails).toEqual(["new@example.com", "billing@example.com"]);
  });

  it("with includeName: false a pure rename is clean and the contact keeps its name", () => {
    const c = contact();
    // Rename only → nothing to write on the contact ('Just here' path).
    expect(
      buildContactBody(c, { ...clientDraftFromContact(c), firstName: "Janet" }, undefined, {
        includeName: false,
      }),
    ).toBeNull();
    // Rename + new phone → the phone is written, the name is NOT.
    const body = buildContactBody(
      c,
      { ...clientDraftFromContact(c), firstName: "Janet", phones: ["+14045551234", "+12928398283"] },
      undefined,
      { includeName: false },
    );
    expect(body).not.toBeNull();
    expect(body!.firstName).toBe("Jane");
    expect(body!.phones).toEqual(["+14045551234", "+12928398283"]);
  });

  it("clientDraftFromContact seeds names from the per-job override when given", () => {
    const c = contact();
    const draft = clientDraftFromContact(c, { firstName: "Janet", lastName: "Poole" });
    expect(draft.firstName).toBe("Janet");
    expect(draft.lastName).toBe("Poole");
    // Phones/email still come from the contact record.
    expect(draft.phones).toEqual(["+14045551234"]);
  });

  it("cleans phones (trim, drop empties) and treats a no-op cleanup as clean", () => {
    const c = contact();
    expect(
      buildContactBody(c, { ...clientDraftFromContact(c), phones: [" +14045551234 ", "", "  "] }),
    ).toBeNull();
  });

  it("keeps the existing phones when the draft would empty them all", () => {
    const c = contact();
    const body = buildContactBody(c, {
      ...clientDraftFromContact(c),
      firstName: "Janet",
      phones: ["", "  "],
    });
    expect(body).not.toBeNull();
    expect(body!.phones).toEqual(["+14045551234"]);
  });

  it("appends a brand-new address once, even with an otherwise clean draft", () => {
    const c = contact();
    const addr: Address = { street: "22 Oak Ave", unit: "B", city: "Tempe", state: "AZ", zip: "85281" };
    const body = buildContactBody(c, clientDraftFromContact(c), addr);
    expect(body).not.toBeNull();
    expect(body!.addresses).toEqual([...c.addresses, addr]);
  });

  it("does not re-append an address already on the client (normalized match)", () => {
    const c = contact();
    // Same address modulo case/whitespace/empty unit — addressInList must match.
    const dup: Address = { street: " 1 main st", unit: "", city: "PHOENIX", state: "az", zip: "85001" };
    expect(buildContactBody(c, clientDraftFromContact(c), dup)).toBeNull();
  });

  it("keeps the address list unchanged when a dirty draft comes with a duplicate address", () => {
    const c = contact();
    const dup: Address = { street: "1 Main St", unit: "", city: "Phoenix", state: "AZ", zip: "85001" };
    const body = buildContactBody(c, { ...clientDraftFromContact(c), firstName: "Janet" }, dup);
    expect(body).not.toBeNull();
    expect(body!.addresses).toEqual(c.addresses);
  });
});

describe("sortJobs", () => {
  const rows = [
    deal({ id: "a", scheduledDate: "2026-08-20", scheduledTimeSlot: "14:00-15:00", createdAt: "2026-08-01T08:30:00.000Z" }),
    deal({ id: "b", scheduledDate: "2026-08-18", scheduledTimeSlot: "08:00-09:00", createdAt: "2026-08-02T16:00:00.000Z" }),
    deal({ id: "c", scheduledDate: "2026-08-19", scheduledTimeSlot: undefined, createdAt: "2026-08-03T12:15:00.000Z" }),
    deal({ id: "d", scheduledDate: undefined, scheduledTimeSlot: undefined, createdAt: "2026-08-04T09:00:00.000Z" }),
  ];

  it("sorts by day, both directions, undated always last", () => {
    expect(sortJobs(rows, { key: "day", dir: "asc" }).map((d) => d.id)).toEqual(["b", "c", "a", "d"]);
    expect(sortJobs(rows, { key: "day", dir: "desc" }).map((d) => d.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("sorts by hour of day across dates, timeless jobs last", () => {
    // 08:00 (b) before 14:00 (a), even though b's day is later in the desc case.
    expect(sortJobs(rows, { key: "hour", dir: "asc" }).map((d) => d.id)).toEqual(["b", "a", "c", "d"]);
    expect(sortJobs(rows, { key: "hour", dir: "desc" }).map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keys off createdAt when asked — day and hour alike", () => {
    expect(sortJobs(rows, { key: "day", dir: "asc" }, "createdAt").map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
    // Hours of createdAt: 08:30 (a), 09:00 (d), 12:15 (c), 16:00 (b).
    expect(sortJobs(rows, { key: "hour", dir: "asc" }, "createdAt").map((d) => d.id)).toEqual(["a", "d", "c", "b"]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((d) => d.id);
    sortJobs(rows, { key: "day", dir: "desc" });
    expect(rows.map((d) => d.id)).toEqual(before);
  });
});

describe("filterDeals — hour range", () => {
  const rows = [
    deal({ id: "a", scheduledDate: "2026-08-20", scheduledTimeSlot: "08:00-09:00" }),
    deal({ id: "b", scheduledDate: "2026-08-20", scheduledTimeSlot: "11:30-12:30" }),
    deal({ id: "c", scheduledDate: "2026-08-21", scheduledTimeSlot: "15:00-16:00" }),
    deal({ id: "d", scheduledDate: "2026-08-21", scheduledTimeSlot: undefined }),
  ];
  const contacts = new Map<string, Contact>();

  it("keeps only jobs whose slot starts inside the inclusive hour window", () => {
    expect(filterDeals(rows, { hourFrom: "08:00", hourTo: "11:30" }, contacts).map((d) => d.id)).toEqual(["a", "b"]);
    expect(filterDeals(rows, { hourFrom: "12:00" }, contacts).map((d) => d.id)).toEqual(["c"]);
    expect(filterDeals(rows, { hourTo: "09:00" }, contacts).map((d) => d.id)).toEqual(["a"]);
  });

  it("drops slotless jobs when an hour window is set, keeps them otherwise", () => {
    expect(filterDeals(rows, { hourFrom: "00:00", hourTo: "23:59" }, contacts).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(filterDeals(rows, {}, contacts)).toHaveLength(4);
  });

  it("combines with the day range", () => {
    expect(
      filterDeals(rows, { dateFrom: "2026-08-21", dateTo: "2026-08-21", hourFrom: "14:00" }, contacts).map((d) => d.id),
    ).toEqual(["c"]);
  });
});

describe("jobDayKey / jobHourKey — one basis for both filters", () => {
  it("schedule basis: day from scheduledDate, hour from the slot start", () => {
    const d = deal({ scheduledDate: "2026-08-20", scheduledTimeSlot: "14:00-15:00", createdAt: "2026-08-01T22:30:00.000Z" });
    expect(jobDayKey(d, "scheduledDate")).toBe("2026-08-20");
    expect(jobHourKey(d, "scheduledDate")).toBe("14:00");
  });

  it("created basis: day and hour are LOCAL, not the UTC string slice", () => {
    // A fixed instant; compare against what the viewer's own clock shows.
    const iso = "2026-08-20T14:00:00.000Z";
    const local = new Date(iso);
    const dd = String(local.getDate()).padStart(2, "0");
    const mm = String(local.getMonth() + 1).padStart(2, "0");
    const hh = String(local.getHours()).padStart(2, "0");
    const min = String(local.getMinutes()).padStart(2, "0");
    const d = deal({ createdAt: iso });
    expect(jobDayKey(d, "createdAt")).toBe(`${local.getFullYear()}-${mm}-${dd}`);
    expect(jobHourKey(d, "createdAt")).toBe(`${hh}:${min}`);
  });

  it("returns empty hour key for a slotless scheduled job", () => {
    expect(jobHourKey(deal({ scheduledDate: "2026-08-20", scheduledTimeSlot: undefined }), "scheduledDate")).toBe("");
  });

  it("closed basis: day and hour are LOCAL from closedAt, empty when open", () => {
    const iso = "2026-08-22T09:45:00.000Z";
    const local = new Date(iso);
    const closed = deal({ closedAt: iso });
    expect(jobDayKey(closed, "closedAt")).toBe(
      `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`,
    );
    expect(jobHourKey(closed, "closedAt")).toBe(
      `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`,
    );
    // A job that isn't closed has no closed day/hour.
    expect(jobDayKey(deal({ closedAt: undefined }), "closedAt")).toBe("");
    expect(jobHourKey(deal({ closedAt: undefined }), "closedAt")).toBe("");
  });
});
