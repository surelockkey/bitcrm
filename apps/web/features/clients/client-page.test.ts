import { describe, it, expect } from "vitest";
import type { Address, Contact, Deal, Estimate, Invoice } from "@bitcrm/types";
import { clientKpis, clientAddressRows, filterAddressRows, amountDueByDeal, jobDateLabel, byJobDateDesc } from "./client-page";

const addr = (street: string, city = "Dallas", zip = "75201", unit?: string): Address => ({
  street,
  city,
  state: "TX",
  zip,
  ...(unit && { unit }),
});

const invoice = (o: Partial<Invoice> & { total: number; balanceDue: number }): Invoice =>
  ({
    id: o.id ?? "i1",
    dealId: o.dealId ?? "d1",
    dueDate: o.dueDate ?? "2026-10-15",
    status: o.status ?? "sent",
    totals: { total: o.total, balanceDue: o.balanceDue, amountPaid: o.total - o.balanceDue },
  }) as unknown as Invoice;

const deal = (o: { id: string; address: Address; total?: number }): Deal =>
  ({ id: o.id, dealNumber: o.id.toUpperCase(), address: o.address, totals: o.total === undefined ? undefined : { total: o.total } }) as unknown as Deal;

describe("clientKpis — Workiz's four cards over the client's invoices and estimates", () => {
  it("adds up what is due, what is past its due date, and all revenue; counts estimates", () => {
    const invoices = [
      invoice({ id: "a", total: 100, balanceDue: 100, dueDate: "2026-09-01" }), // past due
      invoice({ id: "b", total: 250, balanceDue: 50, dueDate: "2026-10-20" }), // due, not yet late
      invoice({ id: "c", total: 300, balanceDue: 0 }), // paid
    ];
    const estimates = [{ id: "e1" }, { id: "e2" }] as Estimate[];

    expect(clientKpis(invoices, estimates, "2026-10-01")).toEqual({
      pastDue: 100,
      due: 150,
      totalRevenue: 650,
      estimates: 2,
    });
  });

  it("an invoice due today is not past due yet, and nothing is negative", () => {
    const invoices = [invoice({ id: "a", total: 10, balanceDue: 10, dueDate: "2026-10-01" })];
    expect(clientKpis(invoices, [], "2026-10-01")).toMatchObject({ pastDue: 0, due: 10 });
    expect(clientKpis([], [], "2026-10-01")).toEqual({ pastDue: 0, due: 0, totalRevenue: 0, estimates: 0 });
  });
});

describe("clientAddressRows — one row per distinct address, as Workiz's Addresses tab", () => {
  const contact = {
    addresses: [addr("241 E FM 1382", "Cedar Hill", "75104"), addr("300 Convent St", "San Antonio", "78205"), addr("300 Convent St", "San Antonio", "78205")],
    billingAddress: addr("200 E Campus View Blvd", "Columbus", "43235"),
  } as unknown as Contact;

  it("de-duplicates by street, unit and zip; the service address is first, the billing address is flagged", () => {
    const rows = clientAddressRows(contact, []);
    expect(rows.map((r) => r.address.street)).toEqual(["241 E FM 1382", "300 Convent St", "200 E Campus View Blvd"]);
    expect(rows[0]).toMatchObject({ isService: true, isBilling: false });
    expect(rows[2]).toMatchObject({ isService: false, isBilling: true });
  });

  it("counts the client's jobs at each address and adds up their totals", () => {
    const deals = [
      deal({ id: "d1", address: addr("300 Convent St", "San Antonio", "78205"), total: 100 }),
      deal({ id: "d2", address: addr("300 convent st", "San Antonio", "78205"), total: 50.5 }), // case-insensitive
      deal({ id: "d3", address: addr("999 Elsewhere", "Austin", "78701") }), // not on the client: still a row
    ];
    const rows = clientAddressRows(contact, deals);
    expect(rows.find((r) => r.address.street === "300 Convent St")).toMatchObject({ jobs: 2, total: 150.5 });
    expect(rows.find((r) => r.address.street === "241 E FM 1382")).toMatchObject({ jobs: 0, total: 0 });
    expect(rows.find((r) => r.address.street === "999 Elsewhere")).toMatchObject({ jobs: 1, total: 0 });
  });

  it("a billing address that is also the service address is one row with both flags", () => {
    const same = addr("1 Main St");
    const rows = clientAddressRows({ addresses: [same], billingAddress: { ...same } } as unknown as Contact, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isService: true, isBilling: true });
  });

  it("filterAddressRows searches street, city, state and zip, ignoring case", () => {
    const rows = clientAddressRows(contact, []);
    expect(filterAddressRows(rows, "convent").map((r) => r.address.city)).toEqual(["San Antonio"]);
    expect(filterAddressRows(rows, "432").map((r) => r.address.city)).toEqual(["Columbus"]);
    expect(filterAddressRows(rows, "  ")).toHaveLength(3);
  });
});

describe("job row helpers", () => {
  it("amountDueByDeal maps each job to its invoice's balance", () => {
    const map = amountDueByDeal([invoice({ id: "i1", dealId: "d1", total: 100, balanceDue: 40 }), invoice({ id: "i2", dealId: "d2", total: 10, balanceDue: 0 })]);
    expect(map.get("d1")).toBe(40);
    expect(map.get("d2")).toBe(0);
    expect(map.get("d3")).toBeUndefined();
  });

  it("jobDateLabel reads like Workiz's Job Date column", () => {
    expect(jobDateLabel({ scheduledDate: "2026-10-09", scheduledTimeSlot: "11:00-12:00" } as Deal)).toBe("Fri Oct 09, 2026 11:00 am");
    expect(jobDateLabel({ scheduledDate: "2026-10-07", allDay: true } as Deal)).toBe("Wed Oct 07, 2026");
    expect(jobDateLabel({} as Deal)).toBe("Unscheduled");
  });
});

describe("byJobDateDesc — Workiz's Jobs tab order", () => {
  it("newest visit first; undated jobs last; ties by creation, newest first", () => {
    const d = (id: string, scheduledDate?: string, createdAt = "2026-01-01T00:00:00.000Z") => ({ id, scheduledDate, createdAt }) as Deal;
    const sorted = [d("old", "2026-09-01"), d("undated"), d("new", "2026-10-09"), d("tie-early", "2026-10-01", "2026-01-01T00:00:00.000Z"), d("tie-late", "2026-10-01", "2026-02-01T00:00:00.000Z")].sort(byJobDateDesc);
    expect(sorted.map((x) => x.id)).toEqual(["new", "tie-late", "tie-early", "old", "undated"]);
  });
});
