import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { PaymentTerms, type Invoice } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn(), canView: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  // This suite asserts the refusal, so `useDenied` mirrors its own `can`
  // instead of declaring that nobody is ever refused.
  useDenied: () => () => !mocks.canView,
  usePermissions: () => ({ can: () => mocks.canView, isLoading: false }),
}));
// The same object on every render, as the real hook's memoised map is: the
// list keeps what it shows by its identity.
vi.mock("@/features/clients/hooks", () => {
  const contacts = {
    map: new Map([
      ["c1", { id: "c1", firstName: "Jane", lastName: "Smith", emails: ["jane@client.test"], phones: [] }],
      ["c2", { id: "c2", firstName: "Joan", lastName: "Thomas", emails: [], phones: ["+16464302536"] }],
    ]),
    isLoading: false,
  };
  return { useContactsByIds: () => contacts };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "t1"), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { InvoicesPage } from "./invoices-page";

const totals = {
  lineCount: 1, subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 100, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100,
};
const inv = (over: Partial<Invoice>): Invoice => ({
  id: "d1", number: "1042", dealId: "d1", contactId: "c1", invoiceDate: "2026-09-16",
  paymentTerms: PaymentTerms.CASH, dueDate: "2026-09-16", status: "due", totals, version: 1,
  createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "", ...over,
});

const listCalls: URLSearchParams[] = [];
const summaryCalls: URLSearchParams[] = [];
const exportCalls: URLSearchParams[] = [];
const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const lastList = () => listCalls[listCalls.length - 1];
const grid = () => screen.getByRole("table", { name: "Invoices" });
const row = (text: RegExp) => within(grid()).getByRole("row", { name: text });
const cells = (r: HTMLElement) => within(r).getAllByRole("cell");
const card = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  mocks.canView = true;
  mocks.push.mockClear();
  listCalls.length = 0;
  summaryCalls.length = 0;
  exportCalls.length = 0;
  server.use(
    http.get("*/billing/invoices/report/summary", ({ request }) => {
      summaryCalls.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        success: true,
        data: { due: { count: 3, amount: 1234.5 }, overdue: { count: 1, amount: 99 }, unsent: { count: 4 }, needInvoices: { count: 2 }, indexReady: true },
      });
    }),
    http.get("*/billing/invoices/report/count", () => HttpResponse.json({ success: true, data: { total: 2, atLeast: false } })),
    http.get("*/billing/invoices/report/export", ({ request }) => {
      exportCalls.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, data: { filename: "invoices-all-time.csv", csv: "Invoice NO.", count: 0, truncated: false } });
    }),
    http.get("*/billing/invoices/report", ({ request }) => {
      const params = new URL(request.url).searchParams;
      listCalls.push(params);
      if (params.get("search") === "zzqxwv") return HttpResponse.json({ success: true, data: { items: [] } });
      if (params.get("cursor") === "next") {
        return HttpResponse.json({ success: true, data: { items: [inv({ id: "d2", dealId: "d2", number: "1043" })] } });
      }
      return HttpResponse.json({ success: true, data: { items: [inv({})], nextCursor: "next" } });
    }),
    http.get("*/billing/invoices/needing-invoice", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "j1", dealNumber: "2001", contactId: "c1", clientName: "Jane Smith", itemCount: 2, total: 50, createdAt: "2026-09-01T00:00:00Z" },
          { id: "j2", dealNumber: "2002", contactId: "c1", clientName: "Jane Smith", itemCount: 1, total: 20, createdAt: "2026-09-02T00:00:00Z" },
        ],
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InvoicesPage — Workiz's /root/invoices/", () => {
  it("draws no title: four cards, Filter results with the date box, the strip, the grid — a page at a time", async () => {
    renderWithClient(<InvoicesPage />);
    expect(await screen.findByRole("button", { name: "$1,234.50 Due from 3 invoices" })).toBeInTheDocument();
    expect(card(/^\$99\.00 Overdue from 1 invoices$/)).toBeInTheDocument();
    expect(card(/^4 invoices Unsent$/)).toBeInTheDocument();
    expect(card(/^2 jobs Need invoices$/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Invoices" })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Filter results" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date range: All time, All time" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveAttribute("placeholder", "Search");
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("10");

    expect(within(grid()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Invoice NO.", "Invoice Name", "Client", "Created", "Subtotal", "Tax", "Discount", "Amount", "Due", "Status", "Job", "Job name",
    ]);
    // Created carries Workiz's sort bar (newest first).
    expect(within(grid()).getByRole("columnheader", { name: "Created" })).toHaveAttribute("aria-sort", "descending");

    const r = row(/1042/);
    const c = cells(r);
    expect(c[0]).toHaveTextContent(/^1042$/);
    expect(within(c[2]).getByText("Jane Smith")).toBeInTheDocument();
    expect(within(c[2]).getByText("jane@client.test")).toBeInTheDocument();
    expect(c[3]).toHaveTextContent("Wed Sep 16, 2026 06:00 am");
    expect(c[4]).toHaveTextContent("$100.00");
    expect(c[6]).toHaveTextContent("0.00%");
    expect(within(c[9]).getByText("Due")).toHaveClass("text-[#f5ad0b]");
    expect(within(c[9]).getByText("Not sent")).toBeInTheDocument();
    expect(within(c[10]).getByRole("link", { name: "1042" })).toHaveAttribute("href", "/deals/d1");
    // All time by default: no created window on either request; ten a page.
    expect(summaryCalls[0].has("from")).toBe(false);
    expect(listCalls[0].has("from")).toBe(false);
    expect(listCalls[0].get("limit")).toBe("10");
    expect(screen.getByText("Showing 1 to 1 of 2 results")).toBeInTheDocument();

    await user().click(screen.getByRole("button", { name: "Next page" }));

    // The second page replaces the first rather than growing under it.
    expect(await within(grid()).findByRole("row", { name: /1043/ })).toBeInTheDocument();
    expect(within(grid()).queryByRole("row", { name: /1042/ })).not.toBeInTheDocument();
  });

  it("a card puts its one chip in Filter results and turns its rule orange; a row opens the job's invoice", async () => {
    renderWithClient(<InvoicesPage />);
    const u = user();
    const overdue = await screen.findByRole("button", { name: /Overdue from 1 invoices/ });
    expect(overdue).toHaveAttribute("aria-pressed", "false");
    await u.click(overdue);
    await waitFor(() => expect(lastList().get("statuses")).toBe("overdue"));
    expect(screen.getByText("status: Overdue")).toBeInTheDocument();
    expect(overdue).toHaveAttribute("aria-pressed", "true");
    // Workiz's `left-orange`: the rule changes, the card stays white.
    expect(overdue.className).toContain("border-l-[#ffae00]");
    expect(overdue.className).not.toContain("bg-[#f0f0f0]");

    // Another card replaces the chip; the card stays picked even once its chip is cleared.
    await u.click(card(/4 invoices Unsent/));
    await waitFor(() => expect(lastList().get("sent")).toBe("unsent"));
    expect(lastList().has("statuses")).toBe(false);
    expect(screen.queryByText("status: Overdue")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(lastList().has("sent")).toBe(false));
    expect(card(/4 invoices Unsent/)).toHaveAttribute("aria-pressed", "true");

    await u.click(within(row(/1042/)).getByText("Jane Smith"));
    expect(mocks.push).toHaveBeenCalledWith("/deals/d1?tab=invoice");
  });

  it("sends Filter results picks, Days due included, as Workiz's chips", async () => {
    renderWithClient(<InvoicesPage />);
    const u = user();
    await screen.findByText("Jane Smith");
    const filter = screen.getByRole("combobox", { name: "Filter results" });
    await u.click(filter);
    await u.click(screen.getByRole("option", { name: "0-30 days" }));
    await u.click(filter);
    await u.click(screen.getByRole("option", { name: "Partially paid" }));
    await waitFor(() => {
      expect(lastList().get("daysDue")).toBe("0_30");
      expect(lastList().get("statuses")).toBe("partially_paid");
    });
    expect(screen.getByText("daysDue: 0-30 days")).toBeInTheDocument();
    expect(screen.getByText("status: Partially paid")).toBeInTheDocument();
  });

  it("leaves Job blank for a client invoice (no job) and opens its own page; ⌘-click opens a new tab", async () => {
    server.use(
      http.get("*/billing/invoices/report", () =>
        HttpResponse.json({ success: true, data: { items: [inv({ id: "inv-9", number: "1001", dealId: undefined, contactId: "c2" })] } }),
      ),
    );
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Joan Thomas");
    const r = row(/1001/);
    expect(cells(r)[10]).toHaveTextContent(/^$/);
    expect(within(r).queryByRole("link", { name: "1001", hidden: false })).toHaveAttribute("href", "/invoices/inv-9");
    // No email: the number, formatted, as a call link.
    expect(within(cells(r)[2]).getByRole("link", { name: "(646) 430-2536" })).toHaveAttribute("href", "tel:+16464302536");
    const u = user();
    await u.click(cells(r)[3]);
    expect(mocks.push).toHaveBeenCalledWith("/invoices/inv-9");
    await u.keyboard("{Meta>}");
    await u.click(cells(r)[4]);
    expect(open).toHaveBeenCalledWith("/invoices/inv-9", "_blank", "noopener,noreferrer");
  });

  it("windows the cards and the list on the chosen dates", async () => {
    renderWithClient(<InvoicesPage />);
    const u = user();
    await screen.findByText("Jane Smith");
    await u.click(screen.getByRole("button", { name: /^Date range/ }));
    expect(screen.getByRole("option", { name: "Recent (30 days, including today)" })).toBeInTheDocument();
    await u.click(screen.getByRole("option", { name: "This month" }));
    await waitFor(() => expect(summaryCalls.some((p) => /-01$/.test(p.get("from") ?? ""))).toBe(true));
    expect(listCalls.some((p) => /-01$/.test(p.get("from") ?? ""))).toBe(true);
  });

  it("searches, and says No Records Found when nothing matches", async () => {
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Jane Smith");
    await user().type(screen.getByRole("textbox", { name: "Search" }), "zzqxwv");
    await waitFor(() => expect(lastList().get("search")).toBe("zzqxwv"));
    expect(await screen.findByText("No Records Found")).toBeInTheDocument();
  });

  it("exports the filtered list as Workiz's CSV", async () => {
    renderWithClient(<InvoicesPage />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /\$99\.00 Overdue/ }));
    await u.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportCalls).toHaveLength(1));
    expect(exportCalls[0].get("statuses")).toBe("overdue");
  });

  it("Need invoices opens Workiz's Jobs window, where jobs are invoiced in bulk one at a time", async () => {
    const created: string[] = [];
    server.use(
      http.post("*/billing/invoices", async ({ request }) => {
        const { dealId } = (await request.json()) as { dealId: string };
        created.push(dealId);
        return HttpResponse.json({ success: true, data: inv({ id: dealId }) });
      }),
    );
    renderWithClient(<InvoicesPage />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /2 jobs Need invoices/ }));
    const dialog = await screen.findByRole("dialog", { name: "Jobs" });
    // Behind the modal (hidden from the reader), the card is the picked one.
    expect(screen.getByRole("button", { name: /2 jobs Need invoices/, hidden: true })).toHaveAttribute("aria-pressed", "true");
    await u.click(await within(dialog).findByRole("checkbox", { name: /select all jobs/i }));
    await u.click(within(dialog).getByRole("button", { name: /create invoices \(2\)/i }));
    await waitFor(() => expect(created).toEqual(["j1", "j2"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Created 2 invoices", { id: "t1" }));
  });

  it("shows no-access without the view permission", () => {
    mocks.canView = false;
    renderWithClient(<InvoicesPage />);
    expect(screen.getByText(/don't have permission to view invoices/i)).toBeInTheDocument();
  });
});

/**
 * Column widths can be dragged and are remembered — Workiz's headers are
 * react-table's `rt-resizable-header` too.
 *
 * The layout is fixed: the clients and the sums arrive with requests of their
 * own, and under auto layout the grid would re-measure itself on each.
 */
describe("InvoicesPage — resizable columns", () => {
  const expectFixed = (table: HTMLTableElement) => {
    expect(table.className).toContain("table-fixed");
    const cols = [...table.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(table.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
    for (const cell of table.querySelectorAll("tbody td")) {
      expect(cell.className).not.toMatch(/\b(min-w|max-w|w)-/);
    }
  };

  it("lays the invoice grid out at declared widths, not by content", async () => {
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Jane Smith");
    expectFixed(grid() as HTMLTableElement);
  });

  it("puts a drag handle on every invoice column", async () => {
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Jane Smith");
    for (const id of ["number", "name", "client", "created", "subtotal", "tax", "discount", "total", "balance", "status", "job", "jobName"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });

  it("does the same for the jobs that need an invoice", async () => {
    renderWithClient(<InvoicesPage />);
    await user().click(await screen.findByRole("button", { name: /2 jobs Need invoices/ }));
    const dialog = await screen.findByRole("dialog", { name: "Jobs" });
    await within(dialog).findByText("2001");
    expectFixed(within(dialog).getByRole("table") as HTMLTableElement);
    for (const id of ["select", "job", "client", "created", "items", "total", "create"]) {
      expect(within(dialog).getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});

describe("InvoicesPage — partial payments", () => {
  it("marks a part-paid invoice while its status stays Due", async () => {
    server.use(
      http.get("*/billing/invoices/report", () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [inv({ totals: { ...totals, amountPaid: 40, balanceDue: 60 } })],
          },
        }),
      ),
    );
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Jane Smith");
    const r = row(/1042/);
    expect(within(r).getByText("Partially paid")).toBeInTheDocument();
    expect(within(r).getByText("Due")).toBeInTheDocument();
  });
});

describe("InvoicesPage — Workiz's figures", () => {
  it("shows Subtotal without the card fee, Amount with the tip, and a cent owed as Paid / $0.00", async () => {
    server.use(
      http.get("*/billing/invoices/report", () =>
        HttpResponse.json({
          success: true,
          data: {
            items: [
              {
                ...inv({ totals: { ...totals, subtotal: 82.55, tax: 5.08, total: 87.63, amountPaid: 87.62, balanceDue: 0.01 } }),
                report: { subtotal: 80, tax: 5.08, amount: 100, balance: 0, status: "paid", tip: 12.37, serviceFee: 2.55 },
              },
            ],
          },
        }),
      ),
    );
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Jane Smith");
    const r = row(/1042/);
    expect(within(r).getByText("$80.00")).toBeInTheDocument();
    expect(within(r).getByText("$100.00")).toBeInTheDocument();
    expect(within(r).getByText("$0.00")).toBeInTheDocument();
    expect(within(r).getByText("Paid")).toHaveClass("text-[#9bc91a]");
    expect(within(r).queryByText("Partially paid")).toBeNull();
  });
});
