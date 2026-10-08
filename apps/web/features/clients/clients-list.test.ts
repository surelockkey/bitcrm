import { describe, expect, it } from "vitest";
import { ContactSource, ContactType, CrmStatus, type Contact } from "@bitcrm/types";
import {
  CLIENT_FIELDS,
  DEFAULT_CLIENT_FIELDS,
  CLIENT_PAGE_SIZES,
  clientAddressLine,
  clientKpis,
  clientSubline,
  formatClientCreated,
  kpiCount,
  kpiMoney,
  sanitizeClientFields,
  searchPager,
} from "./clients-list";

const contact = (over: Partial<Contact> = {}): Contact => ({
  id: "c1",
  firstName: "Deena",
  lastName: "Galange",
  phones: ["+16024783345"],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.MANUAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "2026-10-08T20:26:00.000Z",
  updatedAt: "",
  ...over,
});

describe("clientAddressLine — Workiz's Address cell", () => {
  it("prints street, city, state and zip the way Workiz does", () => {
    expect(clientAddressLine({ street: "261 E 10th St", city: "Mesa", state: "AZ", zip: "85203" })).toBe(
      "261 E 10th St Mesa, AZ 85203",
    );
  });

  it("keeps the unit after the street", () => {
    expect(
      clientAddressLine({ street: "27 Coogan Blvd", unit: "Unit 2B", city: "Stonington", state: "CT", zip: "06355" }),
    ).toBe("27 Coogan Blvd Unit 2B Stonington, CT 06355");
  });

  it("drops what is missing instead of printing stray commas", () => {
    expect(clientAddressLine({ street: "", city: "Waterbury", state: "CT", zip: "" })).toBe("Waterbury, CT");
    expect(clientAddressLine({ street: "12 Elm St", city: "", state: "", zip: "" })).toBe("12 Elm St");
    expect(clientAddressLine(undefined)).toBe("");
  });
});

describe("clientSubline — the line under the client's name", () => {
  it("is the email when the client has one (Quinnipiac University → bspag@qu.edu)", () => {
    expect(clientSubline(contact({ emails: ["bspag@qu.edu"] }))).toEqual({ kind: "email", text: "bspag@qu.edu" });
  });

  it("is the phone when there is no email (Deena Galange → (602) 478-3345)", () => {
    expect(clientSubline(contact())).toEqual({ kind: "phone", phone: "+16024783345" });
  });

  it("is nothing when the client has neither", () => {
    expect(clientSubline(contact({ phones: [] }))).toBeNull();
  });
});

describe("formatClientCreated — Workiz's Created cell", () => {
  it("prints the account's clock: 'Thu Oct 08, 2026 04:26 PM'", () => {
    expect(formatClientCreated("2026-10-08T20:26:00.000Z", "America/New_York")).toBe("Thu Oct 08, 2026 04:26 PM");
  });

  it("keeps two-digit hours in the morning", () => {
    expect(formatClientCreated("2026-03-02T14:05:00.000Z", "America/New_York")).toBe("Mon Mar 02, 2026 09:05 AM");
  });

  it("is empty for a missing or broken date", () => {
    expect(formatClientCreated("")).toBe("");
    expect(formatClientCreated("nope")).toBe("");
  });
});

describe("KPI numbers", () => {
  it("money drops a trailing zero like Workiz ($495,463.7) and keeps cents otherwise", () => {
    expect(kpiMoney(495463.7)).toBe("$495,463.7");
    expect(kpiMoney(121011.91)).toBe("$121,011.91");
    expect(kpiMoney(0)).toBe("$0");
    expect(kpiMoney(12)).toBe("$12");
  });

  it("counts get thousands separators, and a floor gets a +", () => {
    expect(kpiCount(370358)).toBe("370,358");
    expect(kpiCount(5000, true)).toBe("5,000+");
  });
});

describe("the Visible fields registry", () => {
  it("shows Workiz's four by default, in Workiz's order", () => {
    expect(DEFAULT_CLIENT_FIELDS).toEqual(["name", "address", "phone", "created"]);
    expect(CLIENT_FIELDS.slice(0, 4).map((f) => f.label)).toEqual(["Name", "Address", "Phone", "Created"]);
  });

  it("offers ours that Workiz keeps under UNSELECTED FIELDS", () => {
    expect(CLIENT_FIELDS.map((f) => f.id)).toEqual(
      expect.arrayContaining(["company", "email", "source", "type"]),
    );
  });

  it("sanitises what came out of storage: unknown ids out, repeats out, never empty", () => {
    expect(sanitizeClientFields(["phone", "bogus", "name", "phone"])).toEqual(["phone", "name"]);
    expect(sanitizeClientFields([])).toEqual(DEFAULT_CLIENT_FIELDS);
    expect(sanitizeClientFields("x")).toEqual(DEFAULT_CLIENT_FIELDS);
  });

  it("pages like Workiz's size select", () => {
    expect(CLIENT_PAGE_SIZES).toEqual([5, 10, 20, 25, 50, 100]);
  });
});

describe("searchPager — the footer over the search service's pages", () => {
  it("numbers a middle page", () => {
    const p = searchPager({ page: 2, size: 10, total: 23, rows: 10, setPage: () => {} });
    expect(p).toMatchObject({ from: 11, to: 20, total: 23, totalPages: 3, canPrev: true, canNext: true });
  });

  it("stops at the last page", () => {
    const p = searchPager({ page: 3, size: 10, total: 23, rows: 3, setPage: () => {} });
    expect(p).toMatchObject({ from: 21, to: 23, canNext: false });
  });

  it("reads 'Showing 1 to 0 of 0' with nothing found", () => {
    const p = searchPager({ page: 1, size: 10, total: 0, rows: 0, setPage: () => {} });
    expect(p).toMatchObject({ from: 0, to: 0, total: 0, totalPages: 1, canPrev: false, canNext: false });
  });

  it("leaves the total out when the rows were narrowed after the search (tags picked)", () => {
    const p = searchPager({ page: 1, size: 10, total: undefined, rows: 2, setPage: () => {} });
    expect(p.total).toBeUndefined();
    expect(p.totalPages).toBeUndefined();
  });

  it("turns pages through setPage", () => {
    const calls: number[] = [];
    const p = searchPager({ page: 2, size: 10, total: 30, rows: 10, setPage: (n) => calls.push(n) });
    p.prev();
    void p.next();
    expect(calls).toEqual([1, 3]);
  });
});

describe("clientKpis — the four cards over Workiz's Clients list", () => {
  it("reads like Workiz's: Clients, Due (past due included), Past due, Estimates Pending", () => {
    const cards = clientKpis({
      clients: { total: 370358, atLeast: false },
      invoices: { dueAmount: 374451.79, overdueAmount: 121011.91, dueClientCount: 335, overdueClientCount: 260 },
      estimates: { count: 296, amount: 9266476.39 },
    });
    expect(cards.map(({ key, value, caption, tone }) => ({ key, value, caption, tone }))).toEqual([
      { key: "clients", value: "370,358", caption: "Clients", tone: "ink" },
      { key: "due", value: "$495,463.7", caption: "Due from 335 clients", tone: "orange" },
      { key: "pastDue", value: "$121,011.91", caption: "Past due from 260 clients", tone: "red" },
      { key: "estimates", value: "296", caption: "Estimates Pending $9,266,476.39", tone: "ink" },
    ]);
  });

  it("leaves a card out when its numbers are not the viewer's to see", () => {
    expect(clientKpis({ clients: { total: 5 } }).map((c) => c.key)).toEqual(["clients"]);
  });

  it("still reads when the server does not count the owing clients yet", () => {
    const cards = clientKpis({ invoices: { dueAmount: 10, overdueAmount: 0 } });
    expect(cards.map((c) => c.caption)).toEqual(["Due", "Past due"]);
  });

  it("says 'client' for one", () => {
    const cards = clientKpis({ invoices: { dueAmount: 10, overdueAmount: 10, dueClientCount: 1, overdueClientCount: 1 } });
    expect(cards.map((c) => c.caption)).toEqual(["Due from 1 client", "Past due from 1 client"]);
  });
});
