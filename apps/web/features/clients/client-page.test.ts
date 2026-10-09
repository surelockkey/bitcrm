import { describe, it, expect } from "vitest";
import type { Address, Contact, Deal, Estimate, Invoice, Payment } from "@bitcrm/types";
import {
  clientKpis,
  clientAddressRows,
  filterAddressRows,
  amountDueByDeal,
  pastDueByDeal,
  clientJobDate,
  byJobDateDesc,
  wzMoney,
  wzPhone,
  wzDayStart,
} from "./client-page";

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
  it("adds up what is due and what is past its due date; revenue is what was paid on the invoices; counts estimates", () => {
    const invoices = [
      invoice({ id: "a", total: 100, balanceDue: 100, dueDate: "2026-09-01" }), // past due
      invoice({ id: "b", total: 250, balanceDue: 50, dueDate: "2026-10-20" }), // due, not yet late
      invoice({ id: "c", total: 300, balanceDue: 0 }), // paid
    ];
    const estimates = [{ id: "e1" }, { id: "e2" }] as Estimate[];

    expect(clientKpis(invoices, estimates, "2026-10-01")).toEqual({
      pastDue: 100,
      due: 150,
      totalRevenue: 500,
      estimates: 2,
    });
  });

  // Workiz's TOTAL REVENUE is the client's payments (checked on 13 clients
  // against the export: revenue == payments, not invoiced − due).
  it("with the client's payments in hand, revenue is what they paid: settled money, less refunds", () => {
    const invoices = [invoice({ id: "a", total: 100, balanceDue: 100, dueDate: "2026-09-01" })];
    const pay = (o: Partial<Payment>) => ({ amount: 0, refundedAmount: 0, status: "settled", ...o }) as Payment;
    const payments = [
      pay({ id: "p1", amount: 200 }),
      pay({ id: "p2", amount: 50, refundedAmount: 20 }),
      pay({ id: "p3", amount: 75, refundedAmount: 75, status: "refunded" }),
      pay({ id: "p4", amount: 999, status: "pending" }),
      pay({ id: "p5", amount: 999, status: "failed" }),
    ];
    expect(clientKpis(invoices, [], "2026-10-01", payments).totalRevenue).toBe(230);
    expect(clientKpis(invoices, [], "2026-10-01", []).totalRevenue).toBe(0);
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

  it("adds up the balances still due, and past due, on the jobs at each address", () => {
    const deals = [
      deal({ id: "d1", address: addr("300 Convent St", "San Antonio", "78205"), total: 100 }),
      deal({ id: "d2", address: addr("300 Convent St", "San Antonio", "78205"), total: 50 }),
    ];
    const rows = clientAddressRows(contact, deals, { due: new Map([["d1", 30], ["d2", 20]]), pastDue: new Map([["d1", 30]]) });
    expect(rows[1]).toMatchObject({ jobs: 2, total: 150, due: 50, pastDue: 30 });
    expect(rows[0]).toMatchObject({ due: 0, pastDue: 0 });
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
});

describe("Workiz's printing", () => {
  it("wzMoney: plain grouped figures with two decimals, no currency sign", () => {
    expect(wzMoney(67291)).toBe("67,291.00");
    expect(wzMoney(202.654)).toBe("202.65");
    expect(wzMoney(0)).toBe("0.00");
    expect(wzMoney(-12.5)).toBe("-12.50");
  });

  it("wzDayStart: a due date as Workiz's Due By column prints it — the day at midnight", () => {
    expect(wzDayStart("2026-11-05")).toBe("Thu Nov 05, 2026 12:00 am");
    expect(wzDayStart(undefined)).toBe("");
    expect(wzDayStart("soon")).toBe("");
  });

  it('wzPhone: a US number as "(505) 228 - 5946", foreign ones as they are, an extension after', () => {
    expect(wzPhone("+15052285946")).toBe("(505) 228 - 5946");
    expect(wzPhone("+15052285946", "102")).toBe("(505) 228 - 5946 ext. 102");
    expect(wzPhone("+380958601427")).toBe("+380 95 860 1427");
  });
});

describe("pastDueByDeal — Workiz's Past Due column", () => {
  it("is the invoice's balance once its due date has passed, else zero", () => {
    const map = pastDueByDeal(
      [
        invoice({ id: "a", dealId: "d1", total: 100, balanceDue: 40, dueDate: "2026-09-30" }),
        invoice({ id: "b", dealId: "d2", total: 100, balanceDue: 40, dueDate: "2026-10-01" }),
        { ...invoice({ id: "c", total: 5, balanceDue: 5, dueDate: "2026-01-01" }), dealId: undefined } as unknown as Invoice,
      ],
      "2026-10-01",
    );
    expect(map.get("d1")).toBe(40);
    expect(map.get("d2")).toBe(0);
    expect(map.size).toBe(2);
  });
});

describe("clientJobDate — the Job Date column on the account's clock", () => {
  it("converts a visit booked on the job's own clock to the account's, zero-padded", () => {
    const d = { scheduledDate: "2026-09-21", scheduledTimeSlot: "17:00-19:00" } as Deal;
    expect(clientJobDate(d, "America/Los_Angeles", "America/New_York")).toBe("Mon Sep 21, 2026 08:00 pm");
    expect(clientJobDate(d, undefined, "America/New_York")).toBe("Mon Sep 21, 2026 05:00 pm");
  });

  it("an all-day visit keeps the day alone; no date reads Unscheduled", () => {
    expect(clientJobDate({ scheduledDate: "2026-10-09", scheduledTimeSlot: "08:00-09:00", allDay: true } as Deal, undefined, "America/New_York")).toBe(
      "Fri Oct 09, 2026",
    );
    expect(clientJobDate({} as Deal, undefined, "America/New_York")).toBe("Unscheduled");
  });
});

describe("byJobDateDesc — Workiz's Jobs tab order", () => {
  it("newest visit first; undated jobs last; ties by creation, newest first", () => {
    const d = (id: string, scheduledDate?: string, createdAt = "2026-01-01T00:00:00.000Z") => ({ id, scheduledDate, createdAt }) as Deal;
    const sorted = [d("old", "2026-09-01"), d("undated"), d("new", "2026-10-09"), d("tie-early", "2026-10-01", "2026-01-01T00:00:00.000Z"), d("tie-late", "2026-10-01", "2026-02-01T00:00:00.000Z")].sort(byJobDateDesc);
    expect(sorted.map((x) => x.id)).toEqual(["new", "tie-late", "tie-early", "old", "undated"]);
  });
});
