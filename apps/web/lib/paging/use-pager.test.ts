import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { pageWindow, usePager, type PagedSource } from "./use-pager";

/**
 * Сторінки поверх курсора. DynamoDB не вміє «одразу на сьому»: наступну
 * відкриває курсор попередньої. Тому вперед — довантаження, назад — миттєво,
 * бо пройдені сторінки вже в руках.
 */
function source(pages: number[][], hasNext = true): PagedSource<number> {
  return {
    pages,
    hasNextPage: hasNext,
    isFetchingNextPage: false,
    isLoading: false,
    fetchNextPage: async () => {},
  };
}

describe("usePager", () => {
  it("shows the first page and knows another one is waiting", () => {
    const { result } = renderHook(() => usePager(source([[1, 2, 3]]), {}));

    expect(result.current.items).toEqual([1, 2, 3]);
    expect(result.current.page).toBe(1);
    expect(result.current.canPrev).toBe(false);
    expect(result.current.canNext).toBe(true);
  });

  it("walks forward into a page already fetched", () => {
    const { result } = renderHook(() => usePager(source([[1, 2], [3, 4]]), {}));

    act(() => void result.current.next());

    expect(result.current.page).toBe(2);
    expect(result.current.items).toEqual([3, 4]);
    expect(result.current.canPrev).toBe(true);
  });

  it("asks for the next page only when it is not in hand yet", async () => {
    let asked = 0;
    const src = { ...source([[1, 2]]), fetchNextPage: async () => { asked += 1; } };
    const { result } = renderHook(() => usePager(src, {}));

    await act(async () => { await result.current.next(); });

    expect(asked).toBe(1);
  });

  it("goes back without fetching anything", () => {
    const { result } = renderHook(() => usePager(source([[1, 2], [3, 4]]), {}));

    act(() => void result.current.next());
    act(() => void result.current.prev());

    expect(result.current.page).toBe(1);
    expect(result.current.items).toEqual([1, 2]);
  });

  it("jumps straight to a page it has already seen", () => {
    const { result } = renderHook(() => usePager(source([[1], [2], [3]]), {}));

    act(() => void result.current.goto(3));

    expect(result.current.items).toEqual([3]);
  });

  it("fetches when the number clicked is the one past the end", async () => {
    let asked = 0;
    const src = { ...source([[1], [2]]), fetchNextPage: async () => { asked += 1; } };
    const { result } = renderHook(() => usePager(src, {}));

    await act(async () => { await result.current.goto(3); });

    expect(asked).toBe(1);
  });

  it("ignores a number further out than the cursor can reach", async () => {
    let asked = 0;
    const src = { ...source([[1], [2]]), fetchNextPage: async () => { asked += 1; } };
    const { result } = renderHook(() => usePager(src, {}));

    await act(async () => { await result.current.goto(9); });

    expect(asked).toBe(0);
    expect(result.current.page).toBe(1);
  });

  it("counts the rows it is showing, and the whole set when it is known", () => {
    const { result } = renderHook(() => usePager(source([[1, 2], [3, 4]]), { total: 9 }));

    act(() => void result.current.next());

    expect(result.current.from).toBe(3);
    expect(result.current.to).toBe(4);
    expect(result.current.total).toBe(9);
  });

  it("passes on that the total is a floor, not a count", () => {
    const { result } = renderHook(() =>
      usePager(source([[1, 2]]), { total: 10_000, totalIsFloor: true }),
    );

    expect(result.current.totalIsFloor).toBe(true);
  });

  it("numbers the rows by what came before, not by the page size", () => {
    // Сервіс, що фільтрує після читання, віддає коротку сторінку з курсором:
    // рахувати «номер × розмір» означало б показати «Showing 51–52» там, де
    // насправді другий і третій рядки.
    const { result } = renderHook(() => usePager(source([[1], [2, 3]]), {}));

    act(() => void result.current.next());

    expect(result.current.from).toBe(2);
    expect(result.current.to).toBe(3);
  });

  it("returns to the first page when the filters underneath change", () => {
    const { result, rerender } = renderHook(
      ({ key }) => usePager(source([[1, 2], [3, 4]]), { resetKey: key }),
      { initialProps: { key: "open" } },
    );

    act(() => void result.current.next());
    rerender({ key: "done" });

    expect(result.current.page).toBe(1);
  });

  it("has no next page once the source says the last one is loaded", () => {
    const { result } = renderHook(() => usePager(source([[1, 2]], false), {}));

    expect(result.current.canNext).toBe(false);
  });
});


/**
 * «Page 2 of 7» — скільки всього сторінок.
 *
 * Це `ceil(усього рядків / рядків на сторінці)`. Серверний лічильник спиняється
 * на стелі й тоді каже «не менше» — сторінок так само «не менше», і панель
 * пише `7+`. Коли сервер числа не знає (або не може знати для цього
 * викликача), сторінок теж нема — панель просто мовчить про загальну кількість.
 */
describe("usePager — total pages", () => {
  it("divides the row count by the page size, rounding up", () => {
    const { result } = renderHook(() =>
      usePager(source([[1, 2]]), { total: 47, pageSize: 20 }),
    );

    expect(result.current.totalPages).toBe(3);
    expect(result.current.totalPagesIsFloor).toBe(false);
  });

  it("an exact multiple is exactly that many pages", () => {
    const { result } = renderHook(() =>
      usePager(source([[1, 2]]), { total: 40, pageSize: 20 }),
    );

    expect(result.current.totalPages).toBe(2);
  });

  it("an empty list is still one page, not zero", () => {
    const { result } = renderHook(() =>
      usePager(source([[]], false), { total: 0, pageSize: 20 }),
    );

    expect(result.current.totalPages).toBe(1);
  });

  it("a count that stopped on its ceiling makes the page count a floor too", () => {
    const { result } = renderHook(() =>
      usePager(source([[1, 2]]), { total: 10_000, pageSize: 50, totalIsFloor: true }),
    );

    expect(result.current.totalPages).toBe(200);
    expect(result.current.totalPagesIsFloor).toBe(true);
  });

  // Інвойси й естімейти для техніка: сторінка фільтрується після запиту,
  // тож сервер чесно каже, що числа немає.
  it("has no page count when the server could not answer", () => {
    const { result } = renderHook(() =>
      usePager(source([[1, 2]]), { total: null, pageSize: 20 }),
    );

    expect(result.current.totalPages).toBeUndefined();
  });

  it("has no page count when nothing was asked of the server", () => {
    const { result } = renderHook(() => usePager(source([[1, 2]]), { pageSize: 20 }));

    expect(result.current.totalPages).toBeUndefined();
  });

  // Розмір сторінки — те, чим ділять; без нього ділити нема на що.
  it("has no page count without a page size", () => {
    const { result } = renderHook(() => usePager(source([[1, 2]]), { total: 47 }));

    expect(result.current.totalPages).toBeUndefined();
  });
});

describe("pageWindow", () => {
  it("lists every page in hand plus the one the cursor can still open", () => {
    expect(pageWindow({ loaded: 3, hasNext: true, page: 1 })).toEqual([1, 2, 3, 4]);
  });

  it("stops at what is loaded when the set has ended", () => {
    expect(pageWindow({ loaded: 3, hasNext: false, page: 3 })).toEqual([1, 2, 3]);
  });

  it("elides the middle of a long walk, keeping the ends and the neighbours", () => {
    expect(pageWindow({ loaded: 12, hasNext: false, page: 7 })).toEqual([1, "…", 6, 7, 8, "…", 12]);
  });
});
