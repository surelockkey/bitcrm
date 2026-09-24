import { describe, expect, it } from "vitest";
import { PaymentTerms, type Invoice } from "@bitcrm/types";
import { toneClasses } from "@/lib/theme/tone";
import {
  INVOICE_STATUS_META,
  PAYMENT_TERMS_OPTIONS,
  buildInvoiceListQuery,
  dueDateForTerms,
  invoiceStatusLabel,
  paymentTermsLabel,
  sentLabel,
  termDays,
  canCreateInvoice,
  filterByInvoiceChip,
} from "./lib";

describe("invoice status", () => {
  it("labels every derived status", () => {
    expect(invoiceStatusLabel("no_amount")).toBe("No amount");
    expect(invoiceStatusLabel("due")).toBe("Due");
    expect(invoiceStatusLabel("overdue")).toBe("Overdue");
    expect(invoiceStatusLabel("paid")).toBe("Paid");
  });

  it("colors statuses neutral / warning / destructive / success", () => {
    expect(INVOICE_STATUS_META.no_amount.className).toBe(toneClasses("neutral"));
    expect(INVOICE_STATUS_META.due.className).toBe(toneClasses("warning"));
    expect(INVOICE_STATUS_META.overdue.className).toBe(toneClasses("destructive"));
    expect(INVOICE_STATUS_META.paid.className).toBe(toneClasses("success"));
  });

  it("carries no raw palette colour and no dark: variant of its own", () => {
    for (const meta of Object.values(INVOICE_STATUS_META)) {
      expect(meta.className).not.toMatch(/-(amber|red|emerald|slate)-\d/);
      expect(meta.className).not.toContain("dark:");
    }
  });
});

describe("payment terms", () => {
  it("labels terms the Workiz way", () => {
    expect(paymentTermsLabel(PaymentTerms.CASH)).toBe("Due upon receipt");
    expect(paymentTermsLabel(PaymentTerms.NET_15)).toBe("Net 15");
    expect(paymentTermsLabel(PaymentTerms.NET_30)).toBe("Net 30");
    expect(paymentTermsLabel(PaymentTerms.NET_60)).toBe("Net 60");
    expect(paymentTermsLabel(PaymentTerms.CUSTOM)).toBe("Custom");
  });

  it("offers every term as an option", () => {
    expect(PAYMENT_TERMS_OPTIONS.map((o) => o.value)).toEqual(Object.values(PaymentTerms));
  });

  it("knows the days of fixed terms and none for custom", () => {
    expect(termDays(PaymentTerms.CASH)).toBe(0);
    expect(termDays(PaymentTerms.NET_30)).toBe(30);
    expect(termDays(PaymentTerms.CUSTOM)).toBeNull();
  });

  it("recomputes the due date for fixed terms, keeps it for custom", () => {
    expect(dueDateForTerms("2026-09-16", PaymentTerms.NET_15, "2026-09-16")).toBe("2026-10-01");
    expect(dueDateForTerms("2026-09-16", PaymentTerms.CASH, "2026-10-01")).toBe("2026-09-16");
    expect(dueDateForTerms("2026-09-16", PaymentTerms.CUSTOM, "2026-11-01")).toBe("2026-11-01");
  });
});

describe("sentLabel", () => {
  it("says Unsent without a stamp and the date with one", () => {
    expect(sentLabel(undefined)).toBe("Unsent");
    expect(sentLabel("2026-09-01T12:00:00.000Z")).toMatch(/^Sent Sep \d, 2026$/);
  });
});

describe("buildInvoiceListQuery", () => {
  it("serializes only the filters that are set", () => {
    expect(buildInvoiceListQuery({})).toBe("");
    expect(
      buildInvoiceListQuery({ status: "due", unsent: true, from: "2026-09-01", to: "", limit: 25, cursor: "abc" }),
    ).toBe("?status=due&unsent=true&from=2026-09-01&limit=25&cursor=abc");
    expect(buildInvoiceListQuery({ contactId: "c1", unsent: false })).toBe("?contactId=c1");
  });
});

describe("canCreateInvoice", () => {
  it("needs at least one job item", () => {
    expect(canCreateInvoice(0)).toEqual({ allowed: false, reason: "Add at least one item to the job first" });
    expect(canCreateInvoice(2)).toEqual({ allowed: true });
  });
});

describe("filterByInvoiceChip", () => {
  const inv = (status: Invoice["status"], sentAt?: string) => ({ status, sentAt }) as Invoice;
  const rows = [inv("due"), inv("paid", "x"), inv("overdue", "x"), inv("no_amount")];

  it("keeps everything for all, filters by status and unsent", () => {
    expect(filterByInvoiceChip(rows, "all", false)).toHaveLength(4);
    expect(filterByInvoiceChip(rows, "overdue", false)).toHaveLength(1);
    expect(filterByInvoiceChip(rows, "all", true)).toHaveLength(2);
    expect(filterByInvoiceChip(rows, "due", true)).toHaveLength(1);
  });
});

describe("runSequentially", () => {
  it("runs one at a time, reports progress and collects failures", async () => {
    const { runSequentially } = await import("./lib");
    const order: string[] = [];
    let running = 0;
    const progress: number[] = [];
    const result = await runSequentially(
      ["a", "b", "c"],
      async (id) => {
        running += 1;
        expect(running).toBe(1);
        order.push(id);
        await Promise.resolve();
        running -= 1;
        if (id === "b") throw new Error("nope");
      },
      (done) => progress.push(done),
    );
    expect(order).toEqual(["a", "b", "c"]);
    expect(progress).toEqual([1, 2, 3]);
    expect(result.succeeded).toEqual(["a", "c"]);
    expect(result.failed).toEqual([{ id: "b", error: expect.any(Error) }]);
  });
});
