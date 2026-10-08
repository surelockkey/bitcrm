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
import type { Company, Contact, Deal } from "@bitcrm/types";
import { clientDraftFromContact, dealDraftFromDeal } from "./lib";
import {
  addPhoneRow,
  addressSummary,
  commitDetailsSave,
  contactBodyWithCompany,
  phoneRows,
  planDetailsSave,
  removePhoneRow,
  resolveCompanyName,
  withTech,
  withoutTech,
} from "./job-details-form";

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

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    firstName: "Jane",
    lastName: "Smith",
    phones: ["+14045551234"],
    emails: [],
    addresses: [],
    type: ContactType.RESIDENTIAL,
    source: ContactSource.PHONE_CALL,
    status: CrmStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

/* ------------------------------------------------------------ address box */

describe("addressSummary — the job page's one-line address box", () => {
  it("writes the state out in full, as Workiz does: 'Princeton, Princeton, Texas 75407'", () => {
    expect(addressSummary({ street: "Princeton", city: "Princeton", state: "TX", zip: "75407" })).toBe(
      "Princeton, Princeton, Texas 75407",
    );
  });

  it("keeps a state already written out", () => {
    expect(addressSummary({ street: "1 Main", city: "Phoenix", state: "Arizona", zip: "85001" })).toBe(
      "1 Main, Phoenix, Arizona 85001",
    );
  });

  it("puts the unit after the street", () => {
    expect(
      addressSummary({ street: "1221 Merrimac Trail", unit: "Apt 4", city: "Garland", state: "TX", zip: "75043" }),
    ).toBe("1221 Merrimac Trail, Apt 4, Garland, Texas 75043");
  });

  it("names a Canadian province and adds the country outside the US", () => {
    expect(
      addressSummary({ street: "1 King St W", city: "Toronto", state: "ON", zip: "M5H 1A1", country: "CA" }),
    ).toBe("1 King St W, Toronto, Ontario M5H 1A1, Canada");
  });

  it("leaves a region it does not know as typed", () => {
    expect(addressSummary({ street: "10 Downing St", city: "London", state: "Westminster", zip: "SW1A", country: "GB" })).toBe(
      "10 Downing St, London, Westminster SW1A, United Kingdom",
    );
  });

  it("skips the parts that are missing, and is empty for no address", () => {
    expect(addressSummary({ street: "", city: "Dallas", state: "TX", zip: "" })).toBe("Dallas, Texas");
    expect(addressSummary({ street: "", city: "", state: "", zip: "" })).toBe("");
    expect(addressSummary(undefined)).toBe("");
  });
});

/* -------------------------------------------------------------- phone rows */

describe("phoneRows — the Phone | Ext rows of the Client section", () => {
  it("locks the number the job was created with: no editing, no removing", () => {
    const c = contact({ phones: ["+14045551234", "+12028398283"] });
    const rows = phoneRows(c.phones, clientDraftFromContact(c));

    expect(rows[0]).toMatchObject({ value: "+14045551234", locked: true, removable: false, fileIndex: 0 });
    expect(rows[1]).toMatchObject({ value: "+12028398283", locked: false, removable: true, fileIndex: 1 });
  });

  it("locks nothing on a client with no number yet (the first row is a fresh one)", () => {
    const c = contact({ phones: [] });
    const rows = phoneRows(c.phones, clientDraftFromContact(c));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: "", locked: false, removable: false, fileIndex: -1 });
  });

  it("dials only what is on file — a half-typed draft row has no call button", () => {
    const c = contact();
    const draft = addPhoneRow(clientDraftFromContact(c));
    const rows = phoneRows(c.phones, { ...draft, phones: [draft.phones[0], "+1202"] });

    expect(rows[1]).toMatchObject({ value: "+1202", fileIndex: -1, removable: true });
  });

  it("adds an empty row with an empty extension", () => {
    const draft = addPhoneRow(clientDraftFromContact(contact()));

    expect(draft.phones).toEqual(["+14045551234", ""]);
    expect(draft.phoneExts).toEqual(["", ""]);
  });

  it("removes a row together with its extension", () => {
    const c = contact({ phones: ["+14045551234", "+12028398283", "+13055550000"] });
    const draft = { ...clientDraftFromContact(c), phoneExts: ["1", "2", "3"] };

    const next = removePhoneRow(draft, 1);

    expect(next.phones).toEqual(["+14045551234", "+13055550000"]);
    expect(next.phoneExts).toEqual(["1", "3"]);
  });

  it("carries each row's extension", () => {
    const c = contact({ phoneExtensions: { "+14045551234": "102" } });
    expect(phoneRows(c.phones, clientDraftFromContact(c))[0].ext).toBe("102");
  });
});

/* ------------------------------------------------------------------- save */

describe("planDetailsSave — what the single Save would write", () => {
  const base = (over: { deal?: Partial<Deal>; contact?: Partial<Contact>; canEditClient?: boolean } = {}) => {
    const d = deal(over.deal);
    const c = contact(over.contact);
    return {
      deal: d,
      contact: c,
      dealDraft: dealDraftFromDeal(d),
      clientDraft: clientDraftFromContact(c, d.clientName),
      canEditClient: over.canEditClient ?? true,
    };
  };

  it("is clean on a fresh page", () => {
    const plan = planDetailsSave(base());
    expect(plan).toMatchObject({ dirty: false, ask: false, dealPatch: null, contactBody: null, phonesOk: true });
  });

  it("is clean on a job with its own name for the client", () => {
    const plan = planDetailsSave(base({ deal: { clientName: { firstName: "Clinic", lastName: "Of Weatherford" } } }));
    expect(plan.dirty).toBe(false);
    expect(plan.nameChanged).toBe(false);
  });

  it("asks 'Change client' on a rename", () => {
    const input = base();
    const plan = planDetailsSave({ ...input, clientDraft: { ...input.clientDraft!, firstName: "Janet" } });
    expect(plan).toMatchObject({ dirty: true, ask: true, nameChanged: true });
  });

  it("'Just here' pins the name to the job and leaves the contact's name alone", () => {
    const input = { ...base(), dealDraft: { ...base().dealDraft, notes: "PO-9" } };
    const next = { ...input, clientDraft: { ...input.clientDraft!, firstName: "Janet" } };

    const out = commitDetailsSave(next, { applyToClient: false, address: "job-only" });

    expect(out.dealPatch).toEqual({ notes: "PO-9", clientName: { firstName: "Janet", lastName: "Smith" } });
    expect(out.contactBody).toBeNull();
  });

  it("'Yes, make change' renames the contact and drops a stale per-job name", () => {
    const input = base({ deal: { clientName: { firstName: "Clinic", lastName: "Of W" } } });
    const next = { ...input, clientDraft: { ...input.clientDraft!, firstName: "Clinica" } };

    const out = commitDetailsSave(next, { applyToClient: true, address: "job-only" });

    expect(out.dealPatch).toEqual({ clientName: null });
    expect(out.contactBody).toMatchObject({ firstName: "Clinica", lastName: "Of W" });
  });

  it("saves an added phone straight to the client without asking", () => {
    const input = base();
    const clientDraft = { ...input.clientDraft!, phones: ["+14045551234", "+12028398283"], phoneExts: ["", ""] };

    const plan = planDetailsSave({ ...input, clientDraft });
    expect(plan).toMatchObject({ dirty: true, ask: false });

    const out = commitDetailsSave({ ...input, clientDraft }, { applyToClient: true, address: "job-only" });
    expect(out.dealPatch).toBeNull();
    expect(out.contactBody).toMatchObject({ phones: ["+14045551234", "+12028398283"], firstName: "Jane" });
  });

  it("keeps a half-typed phone off the Save", () => {
    const input = base();
    const plan = planDetailsSave({ ...input, clientDraft: { ...input.clientDraft!, phones: ["+14045551234", "+1202"] } });
    expect(plan.phonesOk).toBe(false);
  });

  it("asks about an address the client does not have, and appends it on 'save'", () => {
    const input = base();
    const address = { street: "9 Elm", city: "Dallas", state: "TX", zip: "75201" };
    const next = { ...input, dealDraft: { ...input.dealDraft, address } };

    expect(planDetailsSave(next)).toMatchObject({ ask: true, nameChanged: false, newAddress: address });
    const out = commitDetailsSave(next, { applyToClient: true, address: "save" });
    expect(out.dealPatch).toEqual({ address });
    expect(out.contactBody?.addresses).toEqual([address]);
  });

  it("never writes the contact for someone without contacts.edit", () => {
    const input = base({ canEditClient: false });
    const address = { street: "9 Elm", city: "Dallas", state: "TX", zip: "75201" };
    const next = { ...input, dealDraft: { ...input.dealDraft, address }, clientDraft: { ...input.clientDraft!, firstName: "X" } };

    const plan = planDetailsSave(next);
    expect(plan).toMatchObject({ dirty: true, ask: false, contactBody: null });
    const out = commitDetailsSave(next, { applyToClient: true, address: "save" });
    expect(out.dealPatch).toEqual({ address });
    expect(out.contactBody).toBeNull();
  });

  it("passes the unschedule and the country through to the job", () => {
    const input = base({ deal: { scheduledDate: "2026-10-08", scheduledTimeSlot: "08:00-09:00" } });
    const next = {
      ...input,
      dealDraft: {
        ...input.dealDraft,
        scheduledDate: "",
        scheduledEndDate: "",
        scheduledTimeSlot: "",
        address: { ...input.dealDraft.address, country: "CA" },
      },
    };
    const out = commitDetailsSave(next, { applyToClient: true, address: "job-only" });
    expect(out.dealPatch).toEqual({ scheduledDate: null, address: expect.objectContaining({ country: "CA" }) });
  });

  it("works before the contact has loaded — job fields only", () => {
    const input = { ...base(), contact: undefined, clientDraft: null };
    const plan = planDetailsSave({ ...input, dealDraft: { ...input.dealDraft, notes: "hi" } });
    expect(plan).toMatchObject({ dirty: true, ask: false, contactBody: null });
  });
});

/* ------------------------------------------------------------------- team */

describe("team add / remove", () => {
  it("adds a tech to the end of the team, once", () => {
    expect(withTech(["t1"], "t2")).toEqual(["t1", "t2"]);
    expect(withTech(["t1", "t2"], "t1")).toEqual(["t1", "t2"]);
  });

  it("takes a tech off the team and keeps the others' order", () => {
    expect(withoutTech(["t1", "t2", "t3"], "t2")).toEqual(["t1", "t3"]);
    expect(withoutTech(["t1"], "t9")).toEqual(["t1"]);
  });
});

/* ---------------------------------------------------------- company name */

describe("Company name — the client's CRM company, by title", () => {
  const acme = { id: "co-1", title: "Acme Locks" } as Company;
  const others = [acme, { id: "co-2", title: "Zelli" } as Company];

  it("keeps the company when the box still says its name", () => {
    expect(resolveCompanyName({ typed: " Acme Locks ", currentId: "co-1", currentTitle: "Acme Locks", companies: others })).toEqual({
      kind: "keep",
    });
  });

  it("takes the client off its company when the box is emptied", () => {
    expect(resolveCompanyName({ typed: "  ", currentId: "co-1", currentTitle: "Acme Locks", companies: others })).toEqual({
      kind: "clear",
    });
  });

  it("links an existing company with the same title, in any case", () => {
    expect(resolveCompanyName({ typed: "zelli", currentId: "co-1", currentTitle: "Acme Locks", companies: others })).toEqual({
      kind: "link",
      id: "co-2",
    });
  });

  it("makes a new company for a title nobody has", () => {
    expect(resolveCompanyName({ typed: "New Co ", currentId: undefined, currentTitle: "", companies: others })).toEqual({
      kind: "create",
      title: "New Co",
    });
  });

  it("puts the company on the contact's whole PUT body, even when nothing else changed", () => {
    const c = contact({ companyId: "co-1", emails: ["a@b.c"] });

    expect(contactBodyWithCompany(c, null, "co-2")).toMatchObject({
      firstName: "Jane",
      lastName: "Smith",
      phones: ["+14045551234"],
      emails: ["a@b.c"],
      companyId: "co-2",
    });
    expect(contactBodyWithCompany(c, null, undefined)).toHaveProperty("companyId", undefined);
  });

  it("counts a changed Company name as an edit that saves without asking", () => {
    const d = deal();
    const c = contact();
    const plan = planDetailsSave({
      deal: d,
      contact: c,
      dealDraft: dealDraftFromDeal(d),
      clientDraft: clientDraftFromContact(c),
      canEditClient: true,
      company: { base: "", typed: "Acme Locks" },
    });

    expect(plan).toMatchObject({ dirty: true, ask: false, companyChanged: true });
  });

  it("ignores the Company name for someone without contacts.edit", () => {
    const d = deal();
    const c = contact();
    const plan = planDetailsSave({
      deal: d,
      contact: c,
      dealDraft: dealDraftFromDeal(d),
      clientDraft: clientDraftFromContact(c),
      canEditClient: false,
      company: { base: "", typed: "Acme Locks" },
    });

    expect(plan).toMatchObject({ dirty: false, companyChanged: false });
  });
});
