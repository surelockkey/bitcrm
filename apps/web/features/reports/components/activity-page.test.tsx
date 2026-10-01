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
    text: "Status Updated - In Progress",
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

beforeEach(() => {
  perms.view = true;
  hooks.useActivity.mockReset();
  hooks.useActivityCount.mockReset();
  hooks.useActivity.mockImplementation(() => ({
    data: { pages: [{ success: true, data: rows, pagination: { nextCursor: "c1", count: 3 } }] },
    hasNextPage: true,
    isFetchingNextPage: false,
    isLoading: false,
    isPlaceholderData: false,
    fetchNextPage: vi.fn(),
  }));
  hooks.useActivityCount.mockImplementation(() => ({ data: { total: 3727, atLeast: false } }));
});

const lastFilter = () => hooks.useActivity.mock.calls.at(-1)?.[0];

describe("ActivityPage", () => {
  it("opens on today, newest first, ten rows a page — as Workiz does", () => {
    render(<ActivityPage today="2026-09-29" />);
    expect(lastFilter()).toEqual({ from: "2026-09-29", to: "2026-09-29", userIds: [], q: "", sort: "desc" });
    expect(hooks.useActivity.mock.calls.at(-1)?.[1]).toBe(10);
    expect(screen.getByText("Showing 1 to 3 of 3,727 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 373")).toBeInTheDocument();
  });

  it("prints Workiz's four columns with the device and the job link", () => {
    render(<ActivityPage today="2026-09-29" />);
    const table = screen.getByRole("table", { name: "Activity" });
    const [, first, second, third] = within(table).getAllByRole("row");
    expect(first).toHaveTextContent("Tue Sep 29, 2026 05:54 pm");
    expect(first).toHaveTextContent("Client");
    expect(within(first).getByRole("img", { name: "Web App" })).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "EBKZ0I" })).toHaveAttribute("href", "/deals/d1");
    // Our own event: the teammate's name, not the stored e-mail; done on the phone.
    expect(second).toHaveTextContent("Dana Reed");
    expect(within(second).getByRole("img", { name: "Mobile App" })).toBeInTheDocument();
    // No job: no link.
    expect(within(third).queryByRole("link")).toBeNull();
  });

  it("turns the order round from the Time column", async () => {
    render(<ActivityPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: /Time/ }));
    expect(lastFilter()).toMatchObject({ sort: "asc" });
  });

  it("searches after the typing stops", async () => {
    render(<ActivityPage today="2026-09-29" />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "Logged In");
    await waitFor(() => expect(lastFilter()).toMatchObject({ q: "Logged In" }));
  });

  it("filters by current teammates only", async () => {
    render(<ActivityPage today="2026-09-29" />);
    await userEvent.click(screen.getByRole("button", { name: "Filter results" }));
    const list = screen.getByRole("listbox", { name: "Team" });
    expect(within(list).queryByText("Old Timer")).toBeNull();
    await userEvent.click(within(list).getByRole("checkbox", { name: "Tom Hale" }));
    expect(lastFilter()).toMatchObject({ userIds: ["u-tom"] });
  });

  it("offers Workiz's twenty date options and page sizes", async () => {
    render(<ActivityPage today="2026-09-29" />);
    const presets = screen.getByRole("combobox", { name: "Date preset" });
    expect(within(presets).getAllByRole("option")).toHaveLength(20);
    await userEvent.selectOptions(presets, "this_month");
    expect(lastFilter()).toMatchObject({ from: "2026-09-01", to: "2026-09-29" });
    const sizes = screen.getByRole("combobox", { name: "Rows per page" });
    expect(within(sizes).getAllByRole("option").map((o) => o.textContent)).toEqual(["5", "10", "20", "25", "50", "100"]);
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
