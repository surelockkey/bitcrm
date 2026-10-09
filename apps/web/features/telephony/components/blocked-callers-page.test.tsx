import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BlockedCaller } from "@bitcrm/types";
import { BlockedCallersPage } from "./blocked-callers-page";

const mocks = vi.hoisted(() => ({
  rows: [] as BlockedCaller[],
  unblock: vi.fn(),
  can: vi.fn<(resource: string, action?: string) => boolean>(() => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action?: string) => !mocks.can(resource, action),
  usePermissions: () => ({ can: mocks.can, isLoading: false }),
}));
vi.mock("../blocked-callers-hooks", () => ({
  useBlockedCallers: () => ({ data: mocks.rows, isLoading: false, isSuccess: true, status: "success" }),
  useUnblockCaller: () => ({ mutate: mocks.unblock, isPending: false }),
}));
vi.mock("./block-number-dialog", () => ({
  BlockNumberDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="block-dialog">Block a Number</div> : null),
}));

const row = (over: Partial<BlockedCaller> = {}): BlockedCaller => ({
  id: "b1",
  number: "+12147917112",
  comment: "he doesn't want to pay",
  createdBy: "workiz-import",
  createdAt: "2020-07-29T20:50:18.000Z",
  ...over,
});

/**
 * Workiz Phone → Blocked callers (settings_audit_wz_blocked_callers_v4): its
 * words and "Block a Number", an empty strip (no Search), the grid Number |
 * Comment | Created | Actions (a red bin = unblock), oldest first.
 */
describe("BlockedCallersPage", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.unblock.mockClear();
    mocks.can.mockReturnValue(true);
  });

  it("draws Workiz's words, Block a Number and its columns, with no Search box", () => {
    mocks.rows = [row()];
    render(<BlockedCallersPage />);
    expect(screen.getByText("Define numbers you wish to block like sales calls and other spam callers.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block a Number" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Number", "Comment", "Created", "Actions"]);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("lists a number as Workiz prints it, with its comment and the day it was blocked", () => {
    mocks.rows = [row()];
    render(<BlockedCallersPage />);
    const table = screen.getByRole("table", { name: "Blocked callers" });
    const [, first] = within(table).getAllByRole("row");
    expect(within(first).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "(214) 791-7112",
      "he doesn't want to pay",
      "2020-07-29",
      "",
    ]);
    expect(within(first).getByRole("button", { name: "Unblock (214) 791-7112" })).toBeInTheDocument();
  });

  it("reads oldest first, as Workiz does", () => {
    mocks.rows = [
      row({ id: "b3", number: "+18602889619", createdAt: "2022-11-07T23:48:08.000Z" }),
      row({ id: "b1", number: "+12147917112", createdAt: "2020-07-29T20:50:18.000Z" }),
      row({ id: "b2", number: "+12037601092", createdAt: "2021-07-21T14:06:59.000Z" }),
    ];
    render(<BlockedCallersPage />);
    const table = screen.getByRole("table", { name: "Blocked callers" });
    expect(within(table).getAllByRole("row").slice(1).map((r) => r.firstChild?.textContent)).toEqual([
      "(214) 791-7112",
      "(203) 760-1092",
      "(860) 288-9619",
    ]);
  });

  it("unblocks after a confirmation", async () => {
    mocks.rows = [row()];
    render(<BlockedCallersPage />);
    await userEvent.click(screen.getByRole("button", { name: "Unblock (214) 791-7112" }));
    expect(screen.getByRole("alertdialog", { name: "Unblock (214) 791-7112?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unblock" }));
    expect(mocks.unblock).toHaveBeenCalledWith("+12147917112");
  });

  it("opens the Block a Number form", async () => {
    render(<BlockedCallersPage />);
    await userEvent.click(screen.getByRole("button", { name: "Block a Number" }));
    expect(screen.getByTestId("block-dialog")).toBeInTheDocument();
  });

  it("refuses a viewer without calls.block", () => {
    mocks.can.mockImplementation((_r: string, action?: string) => action !== "block");
    render(<BlockedCallersPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Block a Number" })).not.toBeInTheDocument();
  });
});
