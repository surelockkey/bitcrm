import { describe, expect, it } from "vitest";
import { wzFilterChips } from "@/components/workiz/grouped-filter";
import {
  INVOICE_CARDS,
  INVOICE_FILTER_GROUPS,
  INVOICE_GRID_COLUMNS,
  invoiceCardFilter,
  invoiceCardText,
  invoiceFilterQuery,
  invoiceStatusCell,
} from "./invoices-list";

const summary = {
  due: { count: 563, amount: 490311.99 },
  overdue: { count: 309, amount: 115607.83 },
  unsent: { count: 127 },
  needInvoices: { count: 40 },
};

describe("INVOICE_FILTER_GROUPS — Workiz's Filter results (pg_invoices_wz_06_filter_open)", () => {
  it("offers Status, Days due and Sent in Workiz's order and words (no QuickBooks / Service plan)", () => {
    expect(INVOICE_FILTER_GROUPS.map((g) => g.label)).toEqual(["Status", "Days due", "Sent"]);
    expect(INVOICE_FILTER_GROUPS.map((g) => g.options.map((o) => o.label))).toEqual([
      ["Paid", "Partially paid", "Due", "Overdue"],
      ["0-30 days", "30-60 days", "60-90 days", "90-120 days", "over 120 days"],
      ["Sent", "Unsent"],
    ]);
  });

  it("chips read as Workiz's — the filter type, then the option", () => {
    const chips = wzFilterChips(INVOICE_FILTER_GROUPS, { status: ["overdue"], daysDue: ["0_30"], sent: ["unsent"] });
    expect(chips.map((c) => c.label)).toEqual(["status: Overdue", "daysDue: 0-30 days", "sent: Unsent"]);
  });
});

describe("invoiceFilterQuery", () => {
  it("turns the picks into the list's query lists, OR inside a group", () => {
    expect(invoiceFilterQuery({ status: ["due", "partially_paid"], daysDue: ["30_60"], sent: ["sent"] })).toEqual({
      statuses: ["due", "partially_paid"],
      daysDue: ["30_60"],
      sent: ["sent"],
    });
  });

  it("leaves out empty groups and anything the server does not know", () => {
    expect(invoiceFilterQuery({})).toEqual({});
    expect(invoiceFilterQuery({ status: [], sent: ["maybe"], daysDue: ["0_30", "nope"] })).toEqual({ daysDue: ["0_30"] });
  });
});

describe("the four cards (pg_invoices_wz_01_default)", () => {
  it("are Due, Overdue, Unsent and Need invoices, in that order", () => {
    expect(INVOICE_CARDS).toEqual(["due", "overdue", "unsent", "needInvoices"]);
  });

  it("print Workiz's words: the money over 'Due from N invoices', counts without separators", () => {
    expect(invoiceCardText("due", summary)).toEqual({
      value: "$490,311.99",
      caption: "Due from 563 invoices",
      label: "$490,311.99 Due from 563 invoices",
    });
    expect(invoiceCardText("overdue", summary).caption).toBe("Overdue from 309 invoices");
    expect(invoiceCardText("unsent", { ...summary, unsent: { count: 1270 } })).toEqual({
      value: "1270 invoices",
      caption: "Unsent",
      label: "1270 invoices Unsent",
    });
    expect(invoiceCardText("needInvoices", summary)).toEqual({ value: "40 jobs", caption: "Need invoices", label: "40 jobs Need invoices" });
  });

  it("read zero before the numbers are in", () => {
    expect(invoiceCardText("due", undefined).label).toBe("$0.00 Due from 0 invoices");
    expect(invoiceCardText("unsent", undefined).value).toBe("0 invoices");
  });

  it("each puts its one chip in Filter results; Need invoices opens the jobs instead", () => {
    expect(invoiceCardFilter("due")).toEqual({ status: ["due"] });
    expect(invoiceCardFilter("overdue")).toEqual({ status: ["overdue"] });
    expect(invoiceCardFilter("unsent")).toEqual({ sent: ["unsent"] });
    expect(invoiceCardFilter("needInvoices")).toBeNull();
  });
});

describe("invoiceStatusCell — Workiz's _invStatusCell", () => {
  const totals = { amountPaid: 0 };

  it("colours the status as Workiz does and says when it was sent", () => {
    expect(invoiceStatusCell({ status: "paid", balance: 0 }, totals, "2026-10-09T02:34:40.000Z")).toEqual({
      word: "Paid",
      className: "text-[#9bc91a]",
      partial: false,
      sent: "sent on Thu Oct 08, 2026 10:34 pm",
    });
    expect(invoiceStatusCell({ status: "due", balance: 5 }, totals, undefined)).toMatchObject({
      word: "Due",
      className: "text-[#f5ad0b]",
      sent: "Not sent",
    });
    expect(invoiceStatusCell({ status: "overdue", balance: 5 }, totals, undefined)).toMatchObject({
      word: "Overdue",
      className: "text-wz-error",
    });
    expect(invoiceStatusCell({ status: "no_amount", balance: 0 }, totals, undefined)).toMatchObject({
      word: "No amount",
      className: "text-wz-caption",
    });
  });

  it("marks an open invoice something was paid on (ours), never a paid one", () => {
    expect(invoiceStatusCell({ status: "due", balance: 60 }, { amountPaid: 40 }, undefined).partial).toBe(true);
    expect(invoiceStatusCell({ status: "paid", balance: 0 }, { amountPaid: 100 }, undefined).partial).toBe(false);
  });
});

describe("INVOICE_GRID_COLUMNS — Workiz's columns without the checkbox", () => {
  it("are in Workiz's order, Client twice as wide (flex 100 / 200)", () => {
    expect(INVOICE_GRID_COLUMNS.map((c) => c.label)).toEqual([
      "Invoice NO.",
      "Invoice Name",
      "Client",
      "Created",
      "Subtotal",
      "Tax",
      "Discount",
      "Amount",
      "Due",
      "Status",
      "Job",
      "Job name",
    ]);
    const width = Object.fromEntries(INVOICE_GRID_COLUMNS.map((c) => [c.id, c.width]));
    expect(width.client).toBe(2 * width.number);
    expect(new Set(INVOICE_GRID_COLUMNS.filter((c) => c.id !== "client").map((c) => c.width)).size).toBe(1);
  });
});
