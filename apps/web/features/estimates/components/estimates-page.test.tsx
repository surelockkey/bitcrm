import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Estimate } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn(), deny: new Set<string>() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: (resource: string, action: string) => !mocks.deny.has(`${resource}.${action}`) }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// The same object on every render, as the real hooks' memoised maps are: the
// list keeps what it shows by their identity.
vi.mock("@/features/deals/hooks", () => {
  const users = { map: new Map(), users: [], isLoading: false };
  return { useUserMap: () => users };
});
vi.mock("@/features/clients/hooks", () => {
  const contacts = {
    map: new Map([
      ["c1", { id: "c1", firstName: "Jane", lastName: "Smith", emails: ["jane@x.test"], phones: ["+12035550100"] }],
      ["c2", { id: "c2", firstName: "Bob", lastName: "Stone", emails: [], phones: ["+12039180097"] }],
    ]),
    isLoading: false,
  };
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
const statusCalls: { id: string; body: unknown }[] = [];
let rows: Estimate[] = [];

beforeEach(() => {
  listCalls.length = 0;
  summaryCalls.length = 0;
  exportCalls.length = 0;
  statusCalls.length = 0;
  mocks.push.mockReset();
  mocks.deny.clear();
  rows = [est({ workizTotal: 3968.4, createdByName: "Kris Support Manager", depositPercentage: 50 })];
  server.use(
    http.get("*/billing/estimates/report/summary", ({ request }) => {
      summaryCalls.push(new URL(request.url).searchParams);
      const card = (count: number, amount: number) => ({ count, amount });
      return HttpResponse.json({
        success: true,
        data: {
          unsent: card(21, 3813803.21), pending: card(98, 1552797.77), approved: card(24, 83828.67),
          declined: card(9, 66932.38), won: card(3371, 302977.01), archived: card(127, 325419.46),
          total: card(3650, 6145758.5),
        },
      });
    }),
    http.get("*/billing/estimates/report/count", () =>
      HttpResponse.json({ success: true, data: { total: rows.length } }),
    ),
    http.get("*/billing/estimates/report/export", ({ request }) => {
      exportCalls.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, data: { filename: "estimates-all-time.csv", csv: "Estimate #", count: 0, truncated: false } });
    }),
    http.get("*/billing/estimates/report", ({ request }) => {
      listCalls.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, data: { items: rows } });
    }),
    http.patch("*/billing/estimates/:id/status", async ({ params, request }) => {
      const body = (await request.json()) as { status: string };
      statusCalls.push({ id: String(params.id), body });
      return HttpResponse.json({ success: true, data: { ...rows[0], status: body.status } });
    }),
  );
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("EstimatesPage — Workiz's /root/estimates/", () => {
  it("has no title band: the six status cards come first, each the status over 'N Worth $X'", async () => {
    renderWithClient(<EstimatesPage />);
    const unsent = await screen.findByRole("button", { name: "21 Worth $3,813,803.21 Unsent" });
    expect(unsent).toHaveTextContent(/^Unsent21 Worth \$3,813,803\.21$/);
    // Workiz prints the count without separators.
    expect(screen.getByRole("button", { name: "3371 Worth $302,977.01 Won" })).toBeInTheDocument();
    for (const s of ["Pending", "Approved", "Declined", "Archived"]) {
      expect(screen.getByRole("button", { name: new RegExp(`Worth .* ${s}$`) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "Estimates" })).not.toBeInTheDocument();
    // All time by default.
    expect(summaryCalls[0].has("from")).toBe(false);
  });

  it("draws the estimate in Workiz's columns and words", async () => {
    renderWithClient(<EstimatesPage />);
    const row = await screen.findByRole("row", { name: /1042-1/ });
    const cells = within(row).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual([
      "1042-1",
      "Front door rekey",
      "Jane Smithjane@x.test",
      "Wed Sep 16, 2026 06:00 amAdded by Kris Support Manager",
      "$3,968.40",
      "Pending",
      "Job - 1042",
      "$1,984.20",
    ]);
    expect(within(row).getByRole("link", { name: "1042-1" })).toHaveAttribute("href", "/estimates/e1");
    expect(within(row).getByRole("link", { name: "Job - 1042" })).toHaveAttribute("href", "/deals/d1");
    const headers = screen.getAllByRole("columnheader").map((h) => h.getAttribute("aria-label") ?? h.textContent);
    expect(headers).toEqual(["Estimate", "Estimate Name", "Client", "Created", "Amount", "Status", "Source", "Deposit due"]);
  });

  it("puts the phone under a client without an email, as a call link", async () => {
    rows = [est({ contactId: "c2" })];
    renderWithClient(<EstimatesPage />);
    const row = await screen.findByRole("row", { name: /1042-1/ });
    const phone = within(row).getByRole("link", { name: "(203) 918-0097" });
    expect(phone).toHaveAttribute("href", "tel:+12039180097");
  });

  it("leaves Source blank for a client estimate (no job) and opens the estimate's own page on a row click", async () => {
    rows = [est({ id: "e9", number: "1141", dealId: undefined, dealNumber: undefined, name: "" })];
    renderWithClient(<EstimatesPage />);
    const row = await screen.findByRole("row", { name: /1141/ });
    expect(within(row).queryByText(/Job - /)).not.toBeInTheDocument();
    expect(within(row).getAllByRole("cell")[6]).toHaveTextContent(/^$/);
    expect(within(row).getAllByRole("cell")[1]).toHaveTextContent(/^$/);
    await user().click(within(row).getAllByRole("cell")[1]);
    expect(mocks.push).toHaveBeenCalledWith("/estimates/e9");
  });

  it("dates a won estimate under its status", async () => {
    rows = [est({ status: "won", wonAt: "2026-10-08T15:00:00.000Z" })];
    renderWithClient(<EstimatesPage />);
    const row = await screen.findByRole("row", { name: /1042-1/ });
    // Workiz: "Updated: &nbsp;Oct 08, 2026".
    expect(within(row).getAllByRole("cell")[5].textContent).toBe("WonUpdated:  Oct 08, 2026");
  });

  it("a card sets the status — a second click keeps it, as Workiz's does — and the select follows", async () => {
    renderWithClient(<EstimatesPage />);
    const u = user();
    const won = await screen.findByRole("button", { name: /Worth .* Won$/ });
    await u.click(won);
    await waitFor(() => expect(listCalls.some((p) => p.get("status") === "won")).toBe(true));
    expect(screen.getByRole("button", { name: /Worth .* Won$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Won");
    await u.click(screen.getByRole("button", { name: /Worth .* Won$/ }));
    expect(screen.getByRole("button", { name: /Worth .* Won$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters on the status select: All statuses, then the six", async () => {
    renderWithClient(<EstimatesPage />);
    const u = user();
    const select = await screen.findByRole("combobox", { name: "Status" });
    expect(select).toHaveTextContent("All statuses");
    await u.click(select);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All statuses", "Unsent", "Pending", "Approved", "Declined", "Won", "Archived",
    ]);
    await u.click(screen.getByRole("option", { name: "Approved" }));
    await waitFor(() => expect(listCalls.some((p) => p.get("status") === "approved")).toBe(true));
    expect(screen.getByRole("button", { name: /Worth .* Approved$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("windows on the period box — Workiz's presets, then All time — and exports what is on screen", async () => {
    renderWithClient(<EstimatesPage />);
    const u = user();
    const box = await screen.findByRole("button", { name: "Date range: All time, All time" });
    await u.click(box);
    const options = within(screen.getByRole("listbox", { name: "Date presets" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options[0]).toBe("Custom");
    expect(options.at(-2)).toBe("Last business week (Mon-Fri)");
    expect(options.at(-1)).toBe("All time");
    await u.click(screen.getByRole("option", { name: "Last month" }));
    await waitFor(() => expect(summaryCalls.some((p) => /-01$/.test(p.get("from") ?? ""))).toBe(true));
    await u.click(await screen.findByRole("button", { name: /Worth .* Won$/ }));
    await u.click(screen.getByRole("button", { name: /export/i }));
    await waitFor(() => expect(exportCalls).toHaveLength(1));
    expect(exportCalls[0].get("status")).toBe("won");
    expect(exportCalls[0].get("from")).toMatch(/-01$/);
  });

  it("sorts on Created: newest first with Workiz's bar at the foot, oldest first on a click", async () => {
    renderWithClient(<EstimatesPage />);
    const u = user();
    await screen.findByRole("row", { name: /1042-1/ });
    const created = screen.getByRole("columnheader", { name: "Created" });
    expect(created).toHaveAttribute("aria-sort", "descending");
    expect(listCalls[0].has("dir")).toBe(false);
    await u.click(within(created).getByRole("button", { name: "Sort by Created" }));
    await waitFor(() => expect(listCalls.some((p) => p.get("dir") === "asc")).toBe(true));
    expect(screen.getByRole("columnheader", { name: "Created" })).toHaveAttribute("aria-sort", "ascending");
  });

  it("changes an estimate's status in its row (Workiz's inline select), without opening it", async () => {
    renderWithClient(<EstimatesPage />);
    const u = user();
    const row = await screen.findByRole("row", { name: /1042-1/ });
    await u.click(within(row).getByRole("combobox", { name: "Status of estimate 1042-1" }));
    await u.click(screen.getByRole("option", { name: "Won" }));
    await waitFor(() => expect(statusCalls).toEqual([{ id: "e1", body: { status: "won" } }]));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("prints the status without a select for a reader who may not edit estimates", async () => {
    mocks.deny.add("estimates.edit");
    renderWithClient(<EstimatesPage />);
    const row = await screen.findByRole("row", { name: /1042-1/ });
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(row).getAllByRole("cell")[5]).toHaveTextContent("Pending");
  });

  it("links Estimates settings to our documents defaults, for a reader who may open them", async () => {
    renderWithClient(<EstimatesPage />);
    expect(await screen.findByRole("link", { name: "Estimates settings" })).toHaveAttribute(
      "href",
      "/settings/documents?tab=defaults",
    );
  });

  it("hides Estimates settings and Add New from a reader without those rights", async () => {
    mocks.deny.add("document_templates.view");
    mocks.deny.add("estimates.create");
    renderWithClient(<EstimatesPage />);
    await screen.findByRole("row", { name: /1042-1/ });
    expect(screen.queryByRole("link", { name: "Estimates settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add New" })).not.toBeInTheDocument();
  });

  it("says No Records Found over the blank rows when nothing matches, and the pager reads 0", async () => {
    rows = [];
    renderWithClient(<EstimatesPage />);
    expect(await screen.findByText("No Records Found")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
  });

  it("draws Add New as Workiz's yellow pill", async () => {
    renderWithClient(<EstimatesPage />);
    const add = await screen.findByRole("button", { name: "Add New" });
    expect(add.className).toMatch(/\brounded-pill\b/);
  });

  it("pages by Workiz's sizes, ten to start", async () => {
    renderWithClient(<EstimatesPage />);
    const size = await screen.findByRole("combobox", { name: "Rows per page" });
    expect(size).toHaveValue("10");
    expect(within(size).getAllByRole("option").map((o) => o.textContent)).toEqual(["5", "10", "20", "25", "50", "100"]);
    expect(listCalls[0].get("limit")).toBe("10");
  });
});

/**
 * Ширину колонок можна тягнути, і вона запам'ятовується (як і в Workiz:
 * заголовки react-table там теж розтягуються).
 *
 * Клієнта називає окремий запит, тож за авто-розкладки сітка переміряла б
 * себе, коли ім'я доїде. Ширину задає лише colgroup — клітинка, що поставила
 * б свою, перемогла б її й розсунула сусідів.
 */
describe("EstimatesPage — resizable columns", () => {
  it("lays the estimate list out at declared widths, not by content", async () => {
    const { container } = renderWithClient(<EstimatesPage />);
    await screen.findByRole("row", { name: /1042-1/ });
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
    await screen.findByRole("row", { name: /1042-1/ });
    for (const id of ["number", "name", "client", "created", "total", "status", "job", "deposit"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});

describe("EstimatesPage — Add New (Workiz)", () => {
  it("Add New opens Create New Estimate, which asks for the client first", async () => {
    renderWithClient(<EstimatesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Add New" }));
    const dialog = await screen.findByRole("dialog", { name: "Create New Estimate" });
    expect(within(dialog).getByRole("combobox", { name: "Name, email or phone" })).toBeInTheDocument();
  });
});
