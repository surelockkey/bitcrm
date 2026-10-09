import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationType, ReturnReason, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  transfers: [] as Transfer[],
  /** A second server page, when a test needs paging. */
  more: null as Transfer[] | null,
  listFilters: [] as unknown[],
  countFilters: [] as unknown[],
  permsLoading: false,
  denied: false,
  list: { isLoading: false, isPlaceholderData: false, noData: false },
  namesLoading: false,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => !mocks.permsLoading && mocks.denied,
  usePermissions: () => ({ can: () => !mocks.permsLoading && !mocks.denied, isLoading: mocks.permsLoading }),
}));
vi.mock("../hooks", () => ({
  useTransfers: (filter: unknown) => {
    mocks.listFilters.push(filter);
    return {
    data: mocks.list.noData
      ? undefined
      : {
          pages: [
            { data: mocks.transfers, pagination: {} },
            ...(mocks.more ? [{ data: mocks.more, pagination: {} }] : []),
          ],
        },
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: mocks.list.isLoading,
    isPlaceholderData: mocks.list.isPlaceholderData,
    isError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    };
  },
  useTransfersCount: (filter: unknown) => {
    mocks.countFilters.push(filter);
    return { data: { total: mocks.transfers.length, atLeast: false } };
  },
  useLocationMap: () => ({
    map: mocks.namesLoading
      ? new Map()
      : new Map([
          ["w1", "WAREHOUSE TX"],
          ["c1", "Van 1"],
        ]),
    isLoading: mocks.namesLoading,
  }),
}));
// Обидва діалоги тягнуть react-query самі по собі; тут перевіряється таблиця.
vi.mock("./transfer-record-dialog", () => ({ TransferRecordDialog: () => null }));
vi.mock("./new-transfer-dialog", () => ({ NewTransferDialog: () => null }));

import { TransfersPage } from "./transfers-page";

function transfer(over: Partial<Transfer> = {}): Transfer {
  return {
    id: "t1",
    type: TransferType.TRANSFER,
    fromType: LocationType.WAREHOUSE,
    fromId: "w1",
    toType: LocationType.CONTAINER,
    toId: "c1",
    items: [{ productId: "p1", productName: "Deadbolt", quantity: 4 }],
    performedBy: "u1",
    performedByName: "Jane Smith",
    createdAt: "2026-09-20T10:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  mocks.transfers = [transfer()];
  mocks.more = null;
  mocks.listFilters = [];
  mocks.countFilters = [];
  mocks.permsLoading = false;
  mocks.denied = false;
  mocks.list = { isLoading: false, isPlaceholderData: false, noData: false };
  mocks.namesLoading = false;
});

describe("TransfersPage", () => {
  it("lists a movement with its route, items and who did it", () => {
    render(<TransfersPage />);
    expect(screen.getByText(/Deadbolt/)).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });

  it("left-aligns every column, the date included", () => {
    render(<TransfersPage />);
    for (const el of document.querySelectorAll("th, td")) {
      expect(el.className).not.toMatch(/text-right/);
    }
  });

  it("shows every movement of the page the server sent, returns included", () => {
    mocks.transfers = [
      transfer(),
      transfer({
        id: "t2",
        type: TransferType.RETURN,
        toType: null,
        toId: null,
        items: [{ productId: "p2", productName: "Smart lock", quantity: 1 }],
        reason: ReturnReason.LOST,
      }),
    ];
    render(<TransfersPage />);
    expect(screen.getByText(/Deadbolt/)).toBeInTheDocument();
    expect(screen.getByText(/Smart lock/)).toBeInTheDocument();
  });

  it("has no search box — the server can't search the journal", () => {
    render(<TransfersPage />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

/**
 * The type box is the server's filter: GET /transfers and /transfers/count
 * both take `type`, so the page and its count agree. Nothing is filtered in
 * the browser.
 */
describe("TransfersPage — the type box, filtered on the server", () => {
  const box = () => screen.getByRole("combobox", { name: "Transfer type" });
  const pick = async (name: string) => {
    await userEvent.click(box());
    await userEvent.click(await screen.findByRole("option", { name }));
  };

  it("offers All types, Receive, Transfer, Deduct, Restore and Return, All types first", async () => {
    render(<TransfersPage />);
    expect(box()).toHaveTextContent("All types");
    await userEvent.click(box());
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["All types", "Receive", "Transfer", "Deduct", "Restore", "Return"]));
  });

  it("asks the list and the count for no type under All types", () => {
    render(<TransfersPage />);
    expect(mocks.listFilters.at(-1)).toEqual({});
    expect(mocks.countFilters.at(-1)).toEqual({});
  });

  it("hands the picked type to the list and the count", async () => {
    render(<TransfersPage />);
    await pick("Receive");
    expect(mocks.listFilters.at(-1)).toEqual({ type: TransferType.RECEIVE });
    expect(mocks.countFilters.at(-1)).toEqual({ type: TransferType.RECEIVE });
    await pick("Return");
    expect(mocks.listFilters.at(-1)).toEqual({ type: TransferType.RETURN });
    await pick("All types");
    expect(mocks.listFilters.at(-1)).toEqual({});
  });

  // Whatever the server sends is the page: a row of another type is shown,
  // not dropped in the browser.
  it("shows the page the server sent without filtering it again", async () => {
    render(<TransfersPage />);
    await pick("Receive");
    expect(screen.getByText(/Deadbolt/)).toBeInTheDocument();
  });

  it("starts again from page 1 when the type changes", async () => {
    mocks.more = [transfer({ id: "t9", items: [{ productId: "p9", productName: "Smart lock", quantity: 1 }] })];
    render(<TransfersPage />);
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText(/Smart lock/)).toBeInTheDocument();
    await pick("Deduct");
    expect(screen.getByText(/^Page 1\b/)).toBeInTheDocument();
    expect(screen.getByText(/Deadbolt/)).toBeInTheDocument();
  });
});

/** Workiz's grid: the column decides its width, the reader can drag the edge. */
describe("TransfersPage — a stable first frame", () => {
  const table = () => render(<TransfersPage />).container;

  it("lays the columns out at declared widths, not by content", () => {
    expect(table().querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const c = table();
    const cols = [...c.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(c.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  it("clips every cell rather than letting it spill into the next column", () => {
    for (const td of table().querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/overflow-hidden/);
    }
  });

  it("offers a drag handle on every header", () => {
    table();
    for (const id of ["type", "route", "items", "by", "when"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});

describe("TransfersPage — nothing jumps", () => {
  // Workiz's grid is never shorter than ten rows and holds its pager.
  it("draws its rows in Workiz's grid, the pager inside it under them", () => {
    render(<TransfersPage />);
    const grid = document.querySelector("[data-slot=wz-report-grid]");
    expect(grid).toContainElement(screen.getByRole("table"));
    expect(grid).toContainElement(screen.getByTestId("list-pagination"));
  });

  it("draws the grid's header over Workiz's loader while the first page loads, no pager", () => {
    mocks.list = { isLoading: true, isPlaceholderData: false, noData: true };
    render(<TransfersPage />);

    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Type",
      "Route",
      "Items",
      "By",
      "When",
    ]);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByTestId("list-pagination")).toBeNull();
  });

  it("keeps the rows on screen, dimmed, while another type loads", () => {
    mocks.list = { isLoading: false, isPlaceholderData: true, noData: false };
    render(<TransfersPage />);
    expect(screen.getByText(/Deadbolt/)).toBeInTheDocument();
    expect(document.querySelector("[data-slot=wz-report-grid]")).toHaveAttribute("aria-busy", "true");
  });

  it("never flashes No access while permissions are still loading", () => {
    mocks.permsLoading = true;
    render(<TransfersPage />);
    expect(screen.queryByText("No access")).toBeNull();
    expect(screen.getByRole("button", { name: /Add New/ })).toBeDisabled();
  });

  it("says No access once it is known", () => {
    mocks.denied = true;
    render(<TransfersPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  // Drawn before the names, every route showed grey bars (or the word
  // "Warehouse") and changed a beat later: the rows wait for the names.
  it("waits for the location names before it draws a route", () => {
    mocks.namesLoading = true;
    render(<TransfersPage />);
    expect(screen.queryByTestId("route-name-pending")).toBeNull();
    expect(document.querySelector("tbody")).not.toHaveTextContent("Warehouse");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
