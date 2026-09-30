import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationType, ReturnReason, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({ transfers: [] as Transfer[] }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../hooks", () => ({
  useTransfers: () => ({
    data: { pages: [{ data: mocks.transfers, pagination: {} }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useTransfersCount: () => ({ data: { total: mocks.transfers.length, atLeast: false } }),
  useLocationMap: () => ({
    map: new Map([
      ["w1", "WAREHOUSE TX"],
      ["c1", "Van 1"],
    ]),
    isLoading: false,
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

  // The server can't filter the journal by type or text yet, and filtering the
  // one page on screen gives a different handful on every page — so no chips
  // and no search until it can.
  it("has no type chips or search box that would filter only the page on screen", () => {
    render(<TransfersPage />);
    for (const name of ["All", "Receive", "Transfer", "Deduct", "Restore", "Return"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
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

  // `min-w` на комірці б'є оголошену ширину й зсуває рядок убік.
  it("leaves the width to the column — no cell sets one of its own", () => {
    for (const el of table().querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/(^|\s)(min-)?w-/);
    }
  });

  it("clips every cell rather than letting it spill into the next column", () => {
    for (const td of table().querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/truncate|overflow-hidden/);
    }
  });

  it("offers a drag handle on every header", () => {
    table();
    for (const id of ["type", "route", "items", "by", "when"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
