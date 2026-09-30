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
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("../hooks", () => ({
  useTransfers: (filter: unknown) => {
    mocks.listFilters.push(filter);
    return {
    data: {
      pages: [
        { data: mocks.transfers, pagination: {} },
        ...(mocks.more ? [{ data: mocks.more, pagination: {} }] : []),
      ],
    },
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
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
  mocks.more = null;
  mocks.listFilters = [];
  mocks.countFilters = [];
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
 * Чипи типу — фільтр сервера: GET /transfers і /transfers/count беруть `type`,
 * тож сторінка й лічильник рахують те саме. Сторінку в браузері не фільтруємо.
 */
describe("TransfersPage — type chips, filtered on the server", () => {
  const chip = (name: string) => screen.getByRole("button", { name });

  it("offers All, Receive, Transfer, Deduct, Restore and Return, All pressed", () => {
    render(<TransfersPage />);
    for (const name of ["All", "Receive", "Transfer", "Deduct", "Restore", "Return"]) {
      expect(chip(name)).toBeInTheDocument();
    }
    expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Receive")).toHaveAttribute("aria-pressed", "false");
  });

  it("asks the list and the count for no type under All", () => {
    render(<TransfersPage />);
    expect(mocks.listFilters.at(-1)).toEqual({});
    expect(mocks.countFilters.at(-1)).toEqual({});
  });

  it("hands the picked type to the list and the count", async () => {
    render(<TransfersPage />);
    await userEvent.click(chip("Receive"));
    expect(chip("Receive")).toHaveAttribute("aria-pressed", "true");
    expect(mocks.listFilters.at(-1)).toEqual({ type: TransferType.RECEIVE });
    expect(mocks.countFilters.at(-1)).toEqual({ type: TransferType.RECEIVE });
    await userEvent.click(chip("Return"));
    expect(mocks.listFilters.at(-1)).toEqual({ type: TransferType.RETURN });
    await userEvent.click(chip("All"));
    expect(mocks.listFilters.at(-1)).toEqual({});
  });

  // Whatever the server sends is the page: a row of another type is shown,
  // not dropped in the browser.
  it("shows the page the server sent without filtering it again", async () => {
    render(<TransfersPage />);
    await userEvent.click(chip("Receive"));
    expect(screen.getByText(/Deadbolt/)).toBeInTheDocument();
  });

  it("starts again from page 1 when the type changes", async () => {
    mocks.more = [
      transfer({ id: "t9", items: [{ productId: "p9", productName: "Smart lock", quantity: 1 }] }),
    ];
    render(<TransfersPage />);
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(screen.getByText(/Smart lock/)).toBeInTheDocument();
    await userEvent.click(chip("Deduct"));
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/Deadbolt/)).toBeInTheDocument();
  });
});

/**
 * Ширину колонки задає колонка, а не вміст: `table-fixed` плюс `<colgroup>`,
 * межу можна перетягнути, і таблиця цю ширину пам'ятає між візитами.
 */
describe("TransfersPage — a stable first frame", () => {
  const table = () => render(<TransfersPage />).container;

  it("scrolls sideways instead of clipping when the columns outgrow the screen", () => {
    const frame = table().querySelector("[data-slot=table-frame]") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.className).toMatch(/overflow-x-auto/);
    expect(frame.className).not.toMatch(/overflow-hidden/);
  });

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
