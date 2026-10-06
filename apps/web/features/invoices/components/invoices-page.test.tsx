import { beforeEach, describe, expect, it, vi } from "vitest";
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
  usePermissions: () => ({ can: () => mocks.canView }),
}));
// The same object on every render, as the real hook's memoised map is: the
// list keeps what it shows by its identity.
vi.mock("@/features/clients/hooks", () => {
  const contacts = { map: new Map([["c1", { firstName: "Jane", lastName: "Smith" }]]), isLoading: false };
  return { useContactsByIds: () => contacts };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "t1") }));
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
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

const summaryCalls: URLSearchParams[] = [];
const exportCalls: URLSearchParams[] = [];

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

describe("InvoicesPage", () => {
  it("shows Workiz's cards and the invoice table, a page at a time", async () => {
    renderWithClient(<InvoicesPage />);
    expect(await screen.findByRole("button", { name: /\$1,234\.50 Due from 3 invoices/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /4 invoices Unsent/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 jobs Need invoices/ })).toBeInTheDocument();
    const row = await screen.findByRole("row", { name: /#1042/ });
    expect(within(row).getByText("Jane Smith")).toBeInTheDocument();
    expect(within(row).getByText("Not sent")).toBeInTheDocument();
    // All time by default: no created window on either request.
    expect(summaryCalls[0].has("from")).toBe(false);
    expect(listCalls[0].has("from")).toBe(false);

    await user().click(screen.getByRole("button", { name: "Next page" }));

    // Друга сторінка заступає першу, а не доростає під нею.
    expect(await screen.findByRole("row", { name: /#1043/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /#1042/ })).not.toBeInTheDocument();
  });

  it("filters by status when a card is clicked and opens the job's invoice tab", async () => {
    renderWithClient(<InvoicesPage />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /\$99\.00 Overdue from 1 invoices/ }));
    await waitFor(() => expect(listCalls.some((p) => p.get("statuses") === "overdue")).toBe(true));
    await u.click(await screen.findByRole("row", { name: /#1042/ }));
    expect(mocks.push).toHaveBeenCalledWith("/deals/d1?tab=invoice");
  });

  it("shows a dash in Job for a client invoice (no job) and opens its own page", async () => {
    server.use(
      http.get("*/billing/invoices/report", () =>
        HttpResponse.json({ success: true, data: { items: [inv({ id: "inv-9", number: "1001", dealId: undefined })] } }),
      ),
    );
    renderWithClient(<InvoicesPage />);
    const row = await screen.findByRole("row", { name: /#1001/ });
    expect(within(row).getAllByRole("cell")[10]).toHaveTextContent("—");
    expect(within(row).queryByRole("link", { name: "1001" })).not.toBeInTheDocument();
    await user().click(row);
    expect(mocks.push).toHaveBeenCalledWith("/invoices/inv-9");
  });

  it("filters Unsent from its card, and windows the cards on the chosen dates", async () => {
    renderWithClient(<InvoicesPage />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /4 invoices Unsent/ }));
    await waitFor(() => expect(listCalls.some((p) => p.get("sent") === "unsent")).toBe(true));
    await u.click(screen.getByRole("button", { name: /date range/i }));
    await u.click(screen.getByRole("button", { name: "This month" }));
    await waitFor(() => expect(summaryCalls.some((p) => /-01$/.test(p.get("from") ?? ""))).toBe(true));
    expect(listCalls.some((p) => /-01$/.test(p.get("from") ?? ""))).toBe(true);
  });

  it("exports the filtered list as Workiz's CSV", async () => {
    renderWithClient(<InvoicesPage />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /\$99\.00 Overdue/ }));
    await u.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportCalls).toHaveLength(1));
    expect(exportCalls[0].get("statuses")).toBe("overdue");
  });

  it("bulk-creates invoices one job at a time", async () => {
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
    await u.click(await screen.findByRole("tab", { name: /needs invoice/i }));
    await u.click(await screen.findByRole("checkbox", { name: /select all jobs/i }));
    await u.click(screen.getByRole("button", { name: /create invoices \(2\)/i }));
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
 * Ширину колонок можна тягнути, і вона запам'ятовується.
 *
 * Розкладка фіксована: клієнти й суми доїжджають своїми запитами, і за
 * авто-розкладки сітка переміряла б себе на кожен з них. Через те ж жодна
 * клітинка не сміє задавати свою ширину — вона перемогла б colgroup.
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

  it("lays the invoice list out at declared widths, not by content", async () => {
    const { container } = renderWithClient(<InvoicesPage />);
    await screen.findByRole("row", { name: /#1042/ });
    expectFixed(container.querySelector("table") as HTMLTableElement);
  });

  it("puts a drag handle on every invoice column", async () => {
    renderWithClient(<InvoicesPage />);
    await screen.findByRole("row", { name: /#1042/ });
    for (const id of ["number", "name", "client", "created", "subtotal", "tax", "discount", "total", "balance", "status", "job", "jobName"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });

  it("does the same for the needs-invoice list", async () => {
    const { container } = renderWithClient(<InvoicesPage />);
    await user().click(await screen.findByRole("tab", { name: /needs invoice/i }));
    await screen.findByText("#2001");
    expectFixed(container.querySelector("table") as HTMLTableElement);
    for (const id of ["select", "job", "client", "created", "items", "total", "create"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
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
    const row = (await screen.findByText("#1042")).closest("tr")!;
    expect(within(row).getByText("Partially paid")).toBeInTheDocument();
    expect(within(row).getByText("Due")).toBeInTheDocument();
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
    const row = (await screen.findByText("#1042")).closest("tr")!;
    expect(within(row).getByText("$80.00")).toBeInTheDocument();
    expect(within(row).getByText("$100.00")).toBeInTheDocument();
    expect(within(row).getByText("$0.00")).toBeInTheDocument();
    expect(within(row).getByText("Paid")).toBeInTheDocument();
    expect(within(row).queryByText("Partially paid")).toBeNull();
  });
});
