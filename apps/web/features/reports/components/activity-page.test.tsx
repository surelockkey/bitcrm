import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActivityRow } from "@bitcrm/types";
import { ActivityPage } from "./activity-page";

const perms = vi.hoisted(() => ({ view: true }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => !perms.view,
  usePermissions: () => ({ can: () => perms.view, isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({
    map: new Map([["u-dana", { id: "u-dana", firstName: "Dana", lastName: "Reed" }]]),
    users: [
      { id: "u-dana", firstName: "Dana", lastName: "Reed", status: "active" },
      { id: "u-tom", firstName: "Tom", lastName: "Hale", status: "active" },
      { id: "u-gone", firstName: "Old", lastName: "Timer", status: "inactive" },
    ],
    isLoading: false,
  }),
}));

const rows: ActivityRow[] = [
  {
    id: "a1",
    timestamp: "2026-09-29T21:54:00.600Z",
    actorId: "workiz:unresolved",
    actorName: "Client",
    imported: true,
    text: "Added payment 465.46 in Installments",
    source: "web",
    dealId: "d1",
    jobRef: "EBKZ0I",
  },
  {
    id: "a2",
    timestamp: "2026-09-29T19:03:00.000Z",
    actorId: "u-dana",
    actorName: "dana@x.com",
    imported: false,
    text: "Status Updated - In progress - ",
    source: "mobile",
    dealId: "d2",
    jobRef: "98E4AO",
  },
  {
    id: "a3",
    timestamp: "2026-09-29T19:02:00.000Z",
    actorId: "u-kris",
    actorName: "Kris Support Manager",
    imported: true,
    text: "Logged In From 71.233.152.58",
    source: "web",
  },
];

const hooks = vi.hoisted(() => ({
  useActivity: vi.fn(),
  useActivityCount: vi.fn(),
  exportActivity: vi.fn(),
}));
vi.mock("../activity/hooks", () => hooks);

const page = (data: ActivityRow[], nextCursor?: string) => ({
  data: { pages: [{ success: true, data, pagination: { nextCursor, count: data.length } }] },
  hasNextPage: !!nextCursor,
  isFetchingNextPage: false,
  isLoading: false,
  isPlaceholderData: false,
  fetchNextPage: vi.fn(),
});

beforeEach(() => {
  perms.view = true;
  hooks.useActivity.mockReset();
  hooks.useActivityCount.mockReset();
  hooks.useActivity.mockImplementation(() => page(rows, "c1"));
  hooks.useActivityCount.mockImplementation(() => ({ data: { total: 3727, atLeast: false } }));
});

const lastFilter = () => hooks.useActivity.mock.calls.at(-1)?.[0];
const dateBox = () => screen.getByRole("button", { name: /^Date range:/ });
const pickPreset = async (label: string) => {
  await userEvent.click(dateBox());
  await userEvent.click(within(screen.getByRole("listbox", { name: "Date presets" })).getByRole("option", { name: label }));
};

describe("ActivityPage", () => {
  it("opens on today, newest first, ten rows a page — as Workiz does", () => {
    render(<ActivityPage today="2026-09-29" />);
    expect(lastFilter()).toEqual({ from: "2026-09-29", to: "2026-09-29", userIds: [], q: "", sort: "desc" });
    expect(hooks.useActivity.mock.calls.at(-1)?.[1]).toBe(10);
    expect(dateBox()).toHaveAccessibleName("Date range: Today, Sep 29th, 2026 - Sep 29th, 2026");
    expect(screen.getByText("Showing 1 to 3 of 3727 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 373")).toBeInTheDocument();
    // Workiz opens unsorted: newest first, and no column carries the bar.
    expect(screen.getByRole("columnheader", { name: /Time/ })).not.toHaveAttribute("aria-sort");
    // No title — Workiz's breadcrumb names the page.
    expect(screen.queryByRole("heading", { name: "Activity" })).toBeNull();
  });

  it("prints Workiz's four columns with the device and the job link", () => {
    render(<ActivityPage today="2026-09-29" />);
    const table = screen.getByRole("table", { name: "Activity" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Time", "User", "Action", "Job Id"]);
    const [, first, second, third] = within(table).getAllByRole("row");
    expect(first).toHaveTextContent("Tue Sep 29, 2026 05:54 pm");
    expect(first).toHaveTextContent("Client");
    expect(within(first).getByRole("img", { name: "Web App" })).toBeInTheDocument();
    // Workiz opens the job in the same tab.
    const link = within(first).getByRole("link", { name: "EBKZ0I" });
    expect(link).toHaveAttribute("href", "/deals/d1");
    expect(link).not.toHaveAttribute("target");
    // Our own event: the teammate's name, not the stored e-mail; done on the phone.
    expect(second).toHaveTextContent("Dana Reed");
    expect(within(second).getByRole("img", { name: "Mobile App" })).toBeInTheDocument();
    // No job: no link.
    expect(within(third).queryByRole("link")).toBeNull();
  });

  it("turns the order round from the Time column — ascending first, as react-table", async () => {
    render(<ActivityPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Sort by Time" }));
    expect(lastFilter()).toMatchObject({ sort: "asc" });
    expect(screen.getByRole("columnheader", { name: /Time/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: "Sort by Time" }));
    expect(lastFilter()).toMatchObject({ sort: "desc" });
    expect(screen.getByRole("columnheader", { name: /Time/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("searches after the typing stops", async () => {
    render(<ActivityPage today="2026-09-29" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Search" }), "Logged In");
    await waitFor(() => expect(lastFilter()).toMatchObject({ q: "Logged In" }));
  });

  it("filters by current teammates only, the pick a 'uid:' chip", async () => {
    render(<ActivityPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    const team = screen.getByRole("group", { name: "Team" });
    expect(within(team).queryByText("Old Timer")).toBeNull();
    await userEvent.click(within(team).getByRole("option", { name: "Tom Hale" }));
    expect(lastFilter()).toMatchObject({ userIds: ["u-tom"] });
    expect(screen.getByText("uid: Tom Hale")).toBeInTheDocument();
  });

  it("offers Workiz's twenty date options and page sizes", async () => {
    render(<ActivityPage today="2026-09-29" />);
    await userEvent.click(dateBox());
    expect(within(screen.getByRole("listbox", { name: "Date presets" })).getAllByRole("option")).toHaveLength(20);
    await userEvent.click(screen.getByRole("option", { name: "This month" }));
    expect(lastFilter()).toMatchObject({ from: "2026-09-01", to: "2026-09-29" });
    const sizes = screen.getByRole("combobox", { name: "Rows per page" });
    expect(within(sizes).getAllByRole("option").map((o) => o.textContent)).toEqual(["5", "10", "20", "25", "50", "100"]);
  });

  it("counts 'Last 7 days' up to today", async () => {
    render(<ActivityPage today="2026-10-09" />);
    await pickPreset("Last 7 days");
    expect(lastFilter()).toMatchObject({ from: "2026-10-03", to: "2026-10-09" });
  });

  it("says 'All time' in the box rather than a span of days, as Workiz", async () => {
    render(<ActivityPage today="2026-10-09" />);
    await pickPreset("All time");
    expect(lastFilter()).toMatchObject({ from: "2015-01-01", to: "2026-10-09" });
    expect(dateBox()).toHaveAccessibleName("Date range: All time, All time");
  });

  it("says No Records Found over the blank rows for an empty period", () => {
    hooks.useActivity.mockImplementation(() => page([]));
    hooks.useActivityCount.mockImplementation(() => ({ data: { total: 0, atLeast: false } }));
    render(<ActivityPage today="2026-09-29" />);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
  });

  it("exports the rows as CSV", async () => {
    hooks.exportActivity.mockResolvedValue({ rows, truncated: false });
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    render(<ActivityPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(hooks.exportActivity).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-09-29", to: "2026-09-29" }));
  });

  it("refuses users without the reports permission", () => {
    perms.view = false;
    render(<ActivityPage today="2026-09-29" />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
