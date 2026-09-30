import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { InventoryUsageReportPage } from "./inventory-usage-report-page";

/* ------------------------------------------------------------ the URL */

const nav = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    replace: vi.fn(),
    get: () => params,
    set(qs: string) {
      params = new URLSearchParams(qs);
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const go = (href: string, options?: unknown) => {
    nav.replace(href, options);
    nav.set(href.split("?")[1] ?? "");
  };
  return {
    useSearchParams: () => useSyncExternalStore(nav.subscribe, nav.get, nav.get),
    useRouter: () => ({ replace: go, push: go }),
    usePathname: () => "/reports/inventory-usage",
  };
});

/* ------------------------------------------------------------ who is looking */

const perms = vi.hoisted(() => ({ granted: new Set<string>(), loading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") =>
    !perms.loading && !perms.granted.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") => !perms.loading && perms.granted.has(`${resource}.${action}`),
    isLoading: perms.loading,
  }),
}));

/* ------------------------------------------------------------ the pickers' catalogs */

const lookups = vi.hoisted(() => ({ dealIds: [] as string[][] }));

vi.mock("@/features/deals/hooks", () => {
  const users = [
    { id: "t1", firstName: "Ann", lastName: "Lee", fieldTeamMember: true },
    { id: "t2", firstName: "Bo", lastName: "Chen", fieldTeamMember: true },
    { id: "o1", firstName: "Office", lastName: "Only", fieldTeamMember: false },
  ];
  return {
    useUserMap: () => ({ map: new Map(users.map((u) => [u.id, u])), users, isLoading: false }),
    useDealsByIds: (ids: string[], enabled = true) => {
      if (enabled && ids.length) lookups.dealIds.push([...ids]);
      return {
        data: enabled ? [{ id: "d1", dealNumber: 1749 }].filter((d) => ids.includes(d.id)) : undefined,
        isLoading: false,
      };
    },
  };
});
vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({
    data: [
      { type: "warehouse", id: "w1", name: "Main" },
      { type: "container", id: "c1", name: "Van 7" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/features/inventory/products/hooks", () => ({
  useItemCategories: () => ({ data: [{ id: "cat1", name: "Locks", active: true }], isLoading: false }),
  useBrands: () => ({ data: [{ id: "b1", name: "Nest", active: true }], isLoading: false }),
}));
vi.mock("@/features/inventory/user-containers/hooks", () => ({
  useUserNames: (ids: string[]) => ({
    names: new Map(ids.filter((id) => id === "t2").map((id) => [id, "Bo Chen"])),
    isLoading: false,
  }),
}));

/* ------------------------------------------------------------ the server */

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString();

const USAGE = [
  {
    dealId: "d1",
    dealNumber: 11153,
    jobDate: "2026-09-29",
    clientName: "John Smith",
    techIds: ["t1"],
    techNames: ["Ann Lee"],
    productId: "p1",
    productName: "T3018us Nest Thermostat",
    sku: "T3018US",
    qty: 2,
    unitPrice: 466.79,
    unitCost: 250,
    total: 933.58,
    source: "bitcrm",
  },
  {
    dealId: "d2",
    dealNumber: 6630,
    jobDate: "2026-09-10",
    clientName: "Ferdinand Lee",
    techIds: ["t2"],
    productId: "p2",
    productName: "T500sf Nest Temperature Sensor",
    qty: 10,
    unitPrice: 100,
    unitCost: 20,
    total: 1000,
    source: "workiz",
  },
];
const USAGE_SUMMARY = { rows: 2, qty: 12, total: 1933.58, cost: 700, atLeast: false };

const RETURNS = [
  {
    id: "r1",
    action: "stock_returned",
    productId: "p3",
    productName: "Ecobee Remote Sensor",
    sku: "EB-1",
    quantity: 10,
    reason: "recall",
    fromType: "warehouse",
    fromId: "w1",
    fromName: "Main",
    userId: "u1",
    userName: "Kristian Ibarra",
    createdAt: at(2026, 9, 20, 10, 41),
  },
];

const LOG = [
  {
    id: "l1",
    action: "stock_used",
    productId: "p3",
    productName: "Ecobee Remote Sensor",
    quantity: 1,
    dealId: "d1",
    fromName: "Van 7",
    userId: "u1",
    userName: "Kristian Ibarra",
    createdAt: at(2026, 9, 19, 11, 5),
  },
  {
    id: "l2",
    action: "container_assigned",
    subjectUserId: "t1",
    subjectUserName: "John Smith",
    access: "container",
    toName: "Van 7",
    userId: "u2",
    userName: "Admin Person",
    createdAt: at(2026, 9, 18, 9, 0),
  },
  {
    id: "l3",
    action: "stock_restored",
    productId: "p3",
    productName: "Ecobee Remote Sensor",
    quantity: 1,
    dealId: "d9",
    toName: "Van 7",
    userId: "u1",
    userName: "Kristian Ibarra",
    createdAt: at(2026, 9, 17, 8, 0),
  },
];

type Seen = Record<"usage" | "usageSummary" | "returns" | "returnsSummary" | "log" | "logCount", URLSearchParams[]>;

/** Answers the report endpoints and records every query they receive. */
function serve({
  usage = [USAGE],
  hold = false,
}: { usage?: (typeof USAGE)[]; hold?: boolean } = {}): Seen {
  const seen: Seen = { usage: [], usageSummary: [], returns: [], returnsSummary: [], log: [], logCount: [] };
  const page = <T,>(pages: T[][], q: URLSearchParams) => {
    const i = Number(q.get("cursor") ?? 0);
    return HttpResponse.json({
      success: true,
      data: pages[i] ?? [],
      pagination: { count: (pages[i] ?? []).length, ...(i + 1 < pages.length && { nextCursor: String(i + 1) }) },
    });
  };
  server.use(
    http.get("*/inventory/reports/inventory-usage", async ({ request }) => {
      const q = new URL(request.url).searchParams;
      seen.usage.push(q);
      if (hold) await new Promise(() => {});
      return page(usage, q);
    }),
    http.get("*/inventory/reports/inventory-usage/summary", async ({ request }) => {
      seen.usageSummary.push(new URL(request.url).searchParams);
      if (hold) await new Promise(() => {});
      return HttpResponse.json({ success: true, data: USAGE_SUMMARY });
    }),
    http.get("*/inventory/reports/inventory-returns", ({ request }) => {
      const q = new URL(request.url).searchParams;
      seen.returns.push(q);
      return page([RETURNS], q);
    }),
    http.get("*/inventory/reports/inventory-returns/summary", ({ request }) => {
      seen.returnsSummary.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, data: { rows: 1, qty: 10 } });
    }),
    http.get("*/inventory/inventory-log", ({ request }) => {
      const q = new URL(request.url).searchParams;
      seen.log.push(q);
      return page([LOG], q);
    }),
    http.get("*/inventory/inventory-log/count", ({ request }) => {
      seen.logCount.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, data: { total: 3, atLeast: false } });
    }),
  );
  return seen;
}

const TODAY = "2026-09-30";
const renderPage = () => renderWithClient(<InventoryUsageReportPage today={TODAY} />);
const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

beforeEach(() => {
  nav.set("");
  nav.replace.mockReset();
  lookups.dealIds = [];
  perms.loading = false;
  perms.granted = new Set(["reports.view", "financials.view", "deals.view"]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InventoryUsageReportPage", () => {
  it("is closed to anyone without the reports permission", () => {
    serve();
    perms.granted = new Set(["financials.view"]);
    renderPage();
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });

  it("opens on Inventory Usage for this month, ten rows, by job date", async () => {
    const seen = serve();
    renderPage();

    expect(screen.getByRole("tab", { name: "Inventory Usage" })).toHaveAttribute("aria-selected", "true");
    await screen.findByText("T3018us Nest Thermostat");
    const q = seen.usage[0];
    expect(q.get("from")).toBe("2026-09-01");
    expect(q.get("to")).toBe(TODAY);
    expect(q.get("limit")).toBe("10");
    expect(seen.usageSummary[0].get("from")).toBe("2026-09-01");
  });

  it("shows Workiz's Usage columns, the job as a link to its card", async () => {
    serve();
    renderPage();
    await screen.findByText("T3018us Nest Thermostat");

    expect(headers()).toEqual(["Item", "SKU", "Job", "Client", "Job date", "Techs", "Qty", "Price", "Cost", "Total"]);
    const row = rowOf("T3018us Nest Thermostat");
    expect(within(row).getByRole("link", { name: "11153" })).toHaveAttribute("href", "/deals/d1");
    expect(row).toHaveTextContent("T3018US");
    expect(row).toHaveTextContent("John Smith");
    expect(row).toHaveTextContent("Tue Sep 29, 2026");
    expect(row).toHaveTextContent("Ann Lee");
    expect(row).toHaveTextContent("2.00");
    expect(row).toHaveTextContent("$466.79");
    expect(row).toHaveTextContent("$250.00");
    expect(row).toHaveTextContent("$933.58");
  });

  it("names techs the row carries only as ids", async () => {
    serve();
    renderPage();
    await screen.findByText("T500sf Nest Temperature Sensor");
    expect(rowOf("T500sf Nest Temperature Sensor")).toHaveTextContent("Bo Chen");
  });

  it("marks the rows that came from Workiz", async () => {
    serve();
    renderPage();
    await screen.findByText("T500sf Nest Temperature Sensor");
    expect(within(rowOf("T500sf Nest Temperature Sensor")).getByText("Workiz")).toBeInTheDocument();
    expect(within(rowOf("T3018us Nest Thermostat")).queryByText("Workiz")).toBeNull();
  });

  it("puts the Totals row first: Σ Qty, Σ Cost, Σ Total — never a sum of unit prices", async () => {
    serve();
    renderPage();
    await screen.findByText("T3018us Nest Thermostat");

    const totals = await waitFor(() => {
      const row = rowOf("Totals");
      expect(row).toHaveTextContent("12.00");
      return row;
    });
    expect(totals).toHaveTextContent("$700.00");
    expect(totals).toHaveTextContent("$1,933.58");
    expect(totals).not.toHaveTextContent("566.79");
    // Above the rows, not under them.
    const rows = screen.getAllByRole("row");
    expect(rows.indexOf(totals)).toBeLessThan(rows.indexOf(rowOf("T3018us Nest Thermostat")));
  });

  it("without financials.view: no Price, Cost or Total, and no money in the totals", async () => {
    perms.granted = new Set(["reports.view", "deals.view"]);
    serve();
    renderPage();
    await screen.findByText("T3018us Nest Thermostat");

    expect(headers()).toEqual(["Item", "SKU", "Job", "Client", "Job date", "Techs", "Qty"]);
    expect(rowOf("T3018us Nest Thermostat")).not.toHaveTextContent("$");
    await waitFor(() => expect(rowOf("Totals")).toHaveTextContent("12.00"));
    expect(rowOf("Totals")).not.toHaveTextContent("$");
  });

  it("shows no money, not even in the totals, until the permissions are known", async () => {
    perms.loading = true;
    const seen = serve();
    renderPage();
    await waitFor(() => expect(seen.usageSummary.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(rowOf("Totals")).not.toHaveTextContent("$");
    expect(rowOf("Totals")).not.toHaveTextContent("12.00");
  });

  it("Returns: its own columns, Σ Qty, the tab in the URL", async () => {
    const seen = serve();
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Returns" }));

    expect(nav.replace).toHaveBeenLastCalledWith("/reports/inventory-usage?tab=returns", { scroll: false });
    await screen.findByText("Ecobee Remote Sensor");
    expect(headers()).toEqual(["Item", "SKU", "Return date", "Qty", "Reason", "Location", "User"]);
    const row = rowOf("Ecobee Remote Sensor");
    expect(row).toHaveTextContent("Sun Sep 20 2026 10:41 am");
    expect(row).toHaveTextContent("10.00");
    expect(row).toHaveTextContent("Recall");
    expect(row).toHaveTextContent("Main");
    expect(row).toHaveTextContent("Kristian Ibarra");
    await waitFor(() => expect(rowOf("Totals")).toHaveTextContent("10.00"));
    expect(seen.returns[0].get("from")).toBe("2026-09-01");
  });

  it("Action log: Workiz's descriptions, job numbers resolved in one batch, no totals", async () => {
    nav.set("tab=log");
    serve();
    renderPage();
    await screen.findByText("Used 1 in job #1749");

    expect(headers()).toEqual(["Item", "SKU", "User", "Time", "Description", "Job"]);
    // One lookup for the rows on screen.
    expect(lookups.dealIds.at(-1)?.sort()).toEqual(["d1", "d9"]);
    const used = rowOf("Used 1 in job #1749");
    expect(within(used).getByRole("link", { name: "1749" })).toHaveAttribute("href", "/deals/d1");
    // A job whose number is unknown is still a link, named "Job".
    const back = rowOf("Returned 1 from job to Van 7");
    expect(within(back).getByRole("link", { name: "Job" })).toHaveAttribute("href", "/deals/d9");
    // An entry about a person, not an item.
    const assigned = rowOf("John Smith assigned to Van 7");
    expect(within(assigned).getAllByRole("cell")[0]).toHaveTextContent("—");
    expect(screen.queryByText("Totals")).toBeNull();
  });

  it("changes the window with a preset, and with Custom days", async () => {
    const seen = serve();
    renderPage();
    await screen.findByText("T3018us Nest Thermostat");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "last_month");
    expect(nav.replace).toHaveBeenLastCalledWith("/reports/inventory-usage?range=last_month", { scroll: false });
    await waitFor(() => expect(seen.usage.at(-1)?.get("from")).toBe("2026-08-01"));
    expect(seen.usage.at(-1)?.get("to")).toBe("2026-08-31");
    expect(screen.getByText("Aug 1, 2026 – Aug 31, 2026")).toBeInTheDocument();

    // Editing a day makes the range Custom. (A date field commits whole days.)
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-07-15" } });
    await waitFor(() => expect(seen.usage.at(-1)?.get("from")).toBe("2026-07-15"));
    expect(seen.usage.at(-1)?.get("to")).toBe("2026-08-31");
    expect(screen.getByRole("combobox", { name: "Date range" })).toHaveValue("custom");
    expect(nav.replace).toHaveBeenLastCalledWith(
      "/reports/inventory-usage?range=custom&from=2026-07-15&to=2026-08-31",
      { scroll: false },
    );

    // A year still being typed ("0002-…") is not a day to ask the server about.
    const asked = seen.usage.length;
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "0002-08-31" } });
    expect(nav.replace).toHaveBeenCalledTimes(2);
    expect(seen.usage.length).toBe(asked);
  });

  it("Filter results: several techs at once, each sent to the server, removable", async () => {
    const seen = serve();
    renderPage();
    await screen.findByText("T3018us Nest Thermostat");

    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    // Techs are the field team; office staff are not offered.
    expect(screen.queryByRole("option", { name: /Office Only/ })).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: /Ann Lee/ }));
    await userEvent.click(screen.getByRole("option", { name: /Bo Chen/ }));
    await userEvent.click(screen.getByRole("option", { name: /Van 7/ }));

    await waitFor(() => expect(seen.usage.at(-1)?.getAll("techId")).toEqual(["t1", "t2"]));
    expect(seen.usage.at(-1)?.getAll("locationId")).toEqual(["c1"]);
    expect(seen.usageSummary.at(-1)?.getAll("techId")).toEqual(["t1", "t2"]);

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Remove Ann Lee" }));
    await waitFor(() => expect(seen.usage.at(-1)?.getAll("techId")).toEqual(["t2"]));
  });

  it("searches on the server", async () => {
    const seen = serve();
    renderPage();
    await screen.findByText("T3018us Nest Thermostat");

    await userEvent.type(screen.getByPlaceholderText("Search"), "nest");
    await waitFor(() => expect(seen.usage.at(-1)?.get("search")).toBe("nest"));
    expect(seen.usageSummary.at(-1)?.get("search")).toBe("nest");
  });

  it("pages by 10 by default and by what the reader picks", async () => {
    const seen = serve();
    renderPage();
    await screen.findByText("T3018us Nest Thermostat");

    const size = screen.getByRole("combobox", { name: "Page size" });
    expect([...(size as HTMLSelectElement).options].map((o) => o.value)).toEqual(["10", "25", "50", "100"]);
    await userEvent.selectOptions(size, "25");
    await waitFor(() => expect(seen.usage.at(-1)?.get("limit")).toBe("25"));
  });

  it("while the report loads, the table is already its final shape: a page of rows, Totals, the pager", async () => {
    serve({ hold: true });
    renderPage();

    expect(headers()).toEqual(["Item", "SKU", "Job", "Client", "Job date", "Techs", "Qty", "Price", "Cost", "Total"]);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(10);
    expect(screen.getByText("Totals")).toBeInTheDocument();
    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
  });

  it("exports the whole filtered result, page by page, as CSV", async () => {
    const second = [{ ...USAGE[0], dealId: "d3", dealNumber: 777, productName: "Third item" }];
    const seen = serve({ usage: [USAGE, second] });
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:csv";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderPage();
    await screen.findByText("T3018us Nest Thermostat");
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const drained = seen.usage.filter((q) => q.get("limit") === "100");
    expect(drained.map((q) => q.get("cursor"))).toEqual([null, "1"]);
    const csv = await blobs[0].text();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Item,SKU,Job,Client,Job date,Techs,Qty,Price,Cost,Total");
    expect(csv).toContain("T3018us Nest Thermostat");
    expect(csv).toContain("Third item");
    expect(lines.at(-1)).toBe("Totals,,,,,,12.00,,700.00,1933.58");
  });
});
