import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import { renderWithClient } from "@/test/render-with-client";
import type { CallsFilter } from "../lib";

/**
 * The call log's history section. What is pinned here is the difference
 * between "there are none" and "none in the stretch searched so far": a
 * filtered page is filled by walking the log newest-first and the server stops
 * after a bounded stretch, so an empty page that carries a cursor must offer
 * to read on rather than claim the search is over.
 */
const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  fetchNextPage: vi.fn(),
  /** Розмір сторінки, з яким сторінка покликала хук. */
  listArgs: [] as number[],
  /** Every filter the rows were asked for. */
  filters: [] as CallsFilter[],
  list: {
    data: { pages: [{ data: [] as Array<{ callSid: string }> }] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
  },
}));

vi.mock("../hooks", () => ({
  useCallsList: (filter: CallsFilter, limit: number) => {
    mocks.listArgs.push(limit);
    mocks.filters.push(filter);
    return { ...mocks.list, fetchNextPage: mocks.fetchNextPage };
  },
  // Лічильник сторінок: цим тестам байдуже число, важливо, що панель не падає
  // без нього — тож він «не відповів».
  useCallsCount: () => ({ data: undefined, isError: true }),
  // A server without the summary endpoint: the cards fall back to the count.
  useCallsSummary: () => ({ data: undefined, isError: true }),
}));
vi.mock("../use-call-stream", () => ({ useCallStream: () => undefined }));
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  downloadCallsCsv: mocks.download,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/calls", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
// The live calls, the catalogs the rows print from and the number pill: all in.
vi.mock("../calls-page-data", () => ({
  useCallLogData: () => ({ callTags: [], allIn: true, liveCount: 0, mainNumber: "+12034036303" }),
}));
vi.mock("./call-monitoring", () => ({ CallMonitoring: () => <button type="button">Monitor calls</button> }));
vi.mock("./calls-table", () => ({
  CallsTable: ({ calls, empty }: { calls: Array<{ callSid: string }>; empty?: React.ReactNode }) => (
    <div data-testid="rows">
      {calls.map((c) => c.callSid).join(",")}
      {calls.length === 0 ? empty : null}
    </div>
  ),
  CallsTableSkeleton: () => <div role="status" aria-label="Loading calls" />,
}));

import { CallsPage } from "./calls-page";

describe("CallsPage — the history section", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.fetchNextPage.mockReset();
    mocks.filters.length = 0;
    mocks.list = {
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    };
  });

  it("says there are none only when the whole log has been searched", () => {
    renderWithClient(<CallsPage />);

    expect(screen.getByText("No Calls Found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /keep searching/i })).not.toBeInTheDocument();
  });

  it("offers to read further back when the page is empty but the walk stopped short", () => {
    mocks.list.hasNextPage = true;
    renderWithClient(<CallsPage />);

    expect(screen.queryByText("No Calls Found")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /keep searching/i }));
    expect(mocks.fetchNextPage).toHaveBeenCalled();
  });

  it("pages under a list that did find calls", () => {
    mocks.list.data = { pages: [{ data: [{ callSid: "CA1" }] }] };
    mocks.list.hasNextPage = true;
    renderWithClient(<CallsPage />);

    expect(screen.getByTestId("rows")).toHaveTextContent("CA1");
    expect(screen.getByRole("button", { name: "Next page" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /rows per page/i })).toBeInTheDocument();
  });

  // Workiz's page scrolls only up and down (the 2026-10-09 probes); the grid
  // scrolls sideways on its own. A page that scrolled sideways itself slid
  // the cards and the strip away with it — `sticky left-0` holds nothing
  // that is as wide as its parent.
  it("scrolls only up and down; the controls above the grid are not pinned sideways", () => {
    mocks.list.data = { pages: [{ data: [{ callSid: "CA1" }] }] };
    const { container } = renderWithClient(<CallsPage />);
    const scroller = container.querySelector("[data-slot=calls-scroller]") as HTMLElement;
    expect(scroller.className).toMatch(/\boverflow-y-auto\b/);
    expect(scroller.className).toMatch(/\boverflow-x-hidden\b/);
    expect(scroller.className).not.toMatch(/\boverflow-auto\b/);
    expect(scroller.querySelectorAll("[data-testid=calls-controls] .sticky")).toHaveLength(0);
  });

  it("asks the server for as many calls as the reader chose — ten until then, as Workiz opens", () => {
    mocks.list.data = { pages: [{ data: [{ callSid: "CA1" }] }] };
    renderWithClient(<CallsPage />);
    expect(mocks.listArgs[mocks.listArgs.length - 1]).toBe(10);

    fireEvent.change(screen.getByRole("combobox", { name: /rows per page/i }), { target: { value: "100" } });

    expect(mocks.listArgs[mocks.listArgs.length - 1]).toBe(100);
  });
});

/**
 * The frame Workiz draws round its call log (callspage_wz_01): the heading
 * with the workspace's number, the section's tabs, today's window, the
 * strip's controls — and the window and the search are what the rows are
 * asked for.
 */
describe("CallsPage — Workiz Phone's frame", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.filters.length = 0;
    mocks.list = { data: { pages: [{ data: [{ callSid: "CA1" }] }] }, isLoading: false, hasNextPage: false, isFetchingNextPage: false };
  });

  it("titles the page with the number pill and the section's tabs", () => {
    renderWithClient(<CallsPage />);

    expect(screen.getByRole("heading", { level: 2, name: "BitCRM Phone" })).toBeInTheDocument();
    expect(screen.getByText("(203) 403-6303")).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Phone" });
    expect(within(tabs).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Calls",
      "Phone numbers",
      "Call flows",
      "Call groups",
      "Blocked callers",
      "Devices",
      "Texting",
    ]);
    expect(within(tabs).getByRole("link", { name: "Calls" })).toHaveAttribute("aria-current", "page");
  });

  it("opens on today's calls, as Workiz does", () => {
    renderWithClient(<CallsPage />);

    expect(screen.getByRole("button", { name: /^Date range: Today, / })).toBeInTheDocument();
    const filter = mocks.filters[mocks.filters.length - 1];
    expect(filter.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
    expect(filter.dateTo).toMatch(/T\d{2}:59:59\.999Z$/);
  });

  it("draws the strip's controls: Search, the headset, page size and Fields", () => {
    renderWithClient(<CallsPage />);

    expect(screen.getByRole("textbox", { name: "Search" })).toHaveAttribute("placeholder", "Search");
    expect(screen.getByRole("button", { name: "Monitor calls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fields/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add filter" })).toBeInTheDocument();
  });

  it("searches names and numbers alike: what is typed goes to the server as q", async () => {
    renderWithClient(<CallsPage />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "  Jane Roe " } });

    await waitFor(() => expect(mocks.filters[mocks.filters.length - 1].q).toBe("Jane Roe"));
    expect(mocks.filters[mocks.filters.length - 1].number).toBeUndefined();
  });

  it("draws Workiz's Export in the strip and saves the server's file for the same calls", async () => {
    mocks.download.mockResolvedValue({ blob: new Blob(["Status\n"]), filename: "calls-2026-10-08_2026-10-09.csv" });
    const createObjectURL = vi.fn(() => "blob:x");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWithClient(<CallsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const rowsFilter = mocks.filters[mocks.filters.length - 1];
    expect(mocks.download).toHaveBeenCalledWith(rowsFilter);
    expect(createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });

  it("draws the CALLS card from the log's count when the summary is not served", () => {
    renderWithClient(<CallsPage />);
    // The count did not answer either: no card at all rather than a made-up 0.
    expect(screen.queryByRole("group", { name: "CALLS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "MISSED CALLS" })).not.toBeInTheDocument();
  });
});
