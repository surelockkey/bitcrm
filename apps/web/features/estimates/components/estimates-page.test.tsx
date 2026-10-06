import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Estimate } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// The same object on every render, as the real hooks' memoised maps are: the
// list keeps what it shows by their identity.
vi.mock("@/features/deals/hooks", () => {
  const users = { map: new Map(), users: [], isLoading: false };
  return { useUserMap: () => users };
});
vi.mock("@/features/clients/hooks", () => {
  const contacts = { map: new Map([["c1", { firstName: "Jane", lastName: "Smith" }]]), isLoading: false };
  return {
    useContactSearch: () => ({ data: [], isLoading: false, tooShort: true }),
    useContactsByIds: () => contacts,
  };
});

import { EstimatesPage } from "./estimates-page";

const totals = {
  lineCount: 1, subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 100, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100,
};
const est = (over: Partial<Estimate>): Estimate => ({
  id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042", contactId: "c1",
  name: "Front door rekey", status: "pending", estimateDate: "2026-09-16", totals,
  version: 1, createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "",
  ...over,
} as Estimate);

const listCalls: URLSearchParams[] = [];
const summaryCalls: URLSearchParams[] = [];
const exportCalls: URLSearchParams[] = [];

beforeEach(() => {
  listCalls.length = 0;
  summaryCalls.length = 0;
  exportCalls.length = 0;
  server.use(
    http.get("*/billing/estimates/report/summary", ({ request }) => {
      summaryCalls.push(new URL(request.url).searchParams);
      const card = (count: number, amount: number) => ({ count, amount });
      return HttpResponse.json({
        success: true,
        data: {
          unsent: card(21, 3813803.21), pending: card(98, 1552797.77), approved: card(24, 83828.67),
          declined: card(9, 66932.38), won: card(167, 302977.01), archived: card(127, 325419.46),
          total: card(446, 6145758.5),
        },
      });
    }),
    http.get("*/billing/estimates/report/count", () =>
      HttpResponse.json({ success: true, data: { total: 1 } }),
    ),
    http.get("*/billing/estimates/report/export", ({ request }) => {
      exportCalls.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, data: { filename: "estimates-all-time.csv", csv: "Estimate #", count: 0, truncated: false } });
    }),
    http.get("*/billing/estimates/report", ({ request }) => {
      listCalls.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        success: true,
        data: { items: [est({ workizTotal: 3968.4, createdByName: "Kris Support Manager", depositPercentage: 50 })] },
      });
    }),
  );
});

describe("EstimatesPage", () => {
  it("shows all six Workiz status cards and the estimate in Workiz's columns", async () => {
    renderWithClient(<EstimatesPage />);
    expect(await screen.findByRole("button", { name: /21 Worth \$3,813,803\.21 Unsent/ })).toBeInTheDocument();
    for (const s of ["Pending", "Approved", "Declined", "Won", "Archived"]) {
      expect(screen.getByRole("button", { name: new RegExp(`Worth .* ${s}$`) })).toBeInTheDocument();
    }
    const row = await screen.findByRole("row", { name: /#1042-1/ });
    // Workiz's own Amount (unpicked optional items left out), the author, the source, the deposit.
    expect(within(row).getByText("$3,968.40")).toBeInTheDocument();
    expect(within(row).getByText("Added by Kris Support Manager")).toBeInTheDocument();
    expect(within(row).getByText(/Job - 1042/)).toBeInTheDocument();
    expect(within(row).getByText("$1,984.20")).toBeInTheDocument();
    // All time by default.
    expect(summaryCalls[0].has("from")).toBe(false);
  });

  it("shows a dash in Source for a client estimate (no job) and opens its own page", async () => {
    server.use(
      http.get("*/billing/estimates/report", () =>
        HttpResponse.json({
          success: true,
          data: { items: [est({ id: "e9", number: "1141", dealId: undefined, dealNumber: undefined, name: "" })] },
        }),
      ),
    );
    renderWithClient(<EstimatesPage />);
    const row = await screen.findByRole("row", { name: /#1141/ });
    expect(within(row).queryByText(/Job - /)).not.toBeInTheDocument();
    expect(within(row).getAllByRole("cell")[6]).toHaveTextContent("—");
    await userEvent.setup({ pointerEventsCheck: 0 }).click(row);
    expect(mocks.push).toHaveBeenCalledWith("/estimates/e9");
  });

  it("filters by a status card, windows on the chosen dates and exports", async () => {
    renderWithClient(<EstimatesPage />);
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    await u.click(await screen.findByRole("button", { name: /Worth .* Won$/ }));
    await waitFor(() => expect(listCalls.some((p) => p.get("status") === "won")).toBe(true));
    await u.selectOptions(screen.getByLabelText("Date range"), "last_month");
    await waitFor(() => expect(summaryCalls.some((p) => /-01$/.test(p.get("from") ?? ""))).toBe(true));
    await u.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportCalls).toHaveLength(1));
    expect(exportCalls[0].get("status")).toBe("won");
  });

  it("offers Workiz's presets for this page — no Last 3 months, no Recent", async () => {
    renderWithClient(<EstimatesPage />);
    const select = await screen.findByLabelText("Date range");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toBe("Custom");
    expect(options).toContain("All time");
    expect(options).not.toContain("Last 3 months");
    expect(options).not.toContain("Recent (30 days)");
  });
});

/**
 * Ширину колонок можна тягнути, і вона запам'ятовується.
 *
 * Клієнта називає окремий запит, тож за авто-розкладки сітка переміряла б
 * себе, коли ім'я доїде. Ширину задає лише colgroup — клітинка, що поставила
 * б свою, перемогла б її й розсунула сусідів.
 */
describe("EstimatesPage — resizable columns", () => {
  it("lays the estimate list out at declared widths, not by content", async () => {
    const { container } = renderWithClient(<EstimatesPage />);
    await screen.findByText("#1042-1");
    const table = container.querySelector("table") as HTMLTableElement;
    expect(table.className).toContain("table-fixed");
    const cols = [...table.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(table.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
    for (const cell of table.querySelectorAll("tbody td")) {
      expect(cell.className).not.toMatch(/\b(min-w|max-w|w)-/);
    }
  });

  it("puts a drag handle on every estimate column", async () => {
    renderWithClient(<EstimatesPage />);
    await screen.findByText("#1042-1");
    for (const id of ["number", "name", "client", "created", "total", "status", "job", "deposit"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});

describe("EstimatesPage — Add New (Workiz)", () => {
  it("Add New opens Create New Estimate, which asks for the client first", async () => {
    renderWithClient(<EstimatesPage />);
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    const dialog = await screen.findByRole("dialog", { name: "Create New Estimate" });
    expect(within(dialog).getByRole("combobox", { name: "Name, email or phone" })).toBeInTheDocument();
  });
});
