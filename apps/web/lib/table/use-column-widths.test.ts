import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  COLUMN_MIN_WIDTH,
  COLUMN_MAX_WIDTH,
  storedWidths,
  useColumnWidths,
} from "./use-column-widths";

const DEFAULTS = { client: 200, tech: 170, city: 130 };

beforeEach(() => {
  localStorage.clear();
});

/**
 * Ширини колонок, які пам'ятають вибір читача.
 *
 * Зберігаються по таблиці, як і «по скільки рядків» у `usePageSize`: диспетчер
 * розсуває колонку на роботах, і вона лишається розсунутою завтра — але не
 * тягне за собою інвентар.
 */
describe("useColumnWidths", () => {
  it("starts at the table's own defaults", () => {
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));

    expect(result.current.widthOf("client")).toBe(200);
    expect(result.current.widthOf("tech")).toBe(170);
  });

  it("remembers a column the reader resized", () => {
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));

    act(() => result.current.setWidth("client", 320));

    expect(result.current.widthOf("client")).toBe(320);
    expect(result.current.widthOf("tech")).toBe(170);
  });

  // Сітка, що росте на ширину сторінки, лишає розсунуту читачем колонку як є,
  // а решту ділить — тож їй треба знати, яку з них чіпали.
  it("tells a column the reader sized from one at its default", () => {
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));
    expect(result.current.isSet("client")).toBe(false);

    act(() => result.current.setWidth("client", 320));
    expect(result.current.isSet("client")).toBe(true);
    expect(result.current.isSet("tech")).toBe(false);

    act(() => result.current.reset());
    expect(result.current.isSet("client")).toBe(false);
  });

  it("survives a reload", () => {
    const first = renderHook(() => useColumnWidths("jobs", DEFAULTS));
    act(() => first.result.current.setWidth("client", 320));

    const second = renderHook(() => useColumnWidths("jobs", DEFAULTS));
    expect(second.result.current.widthOf("client")).toBe(320);
  });

  // Робота й інвентар — різні таблиці, і вибір в одній не чіпає іншу.
  it("keeps one table's choice out of another's", () => {
    const jobs = renderHook(() => useColumnWidths("jobs", DEFAULTS));
    act(() => jobs.result.current.setWidth("client", 320));

    const stock = renderHook(() => useColumnWidths("inventory-items", DEFAULTS));
    expect(stock.result.current.widthOf("client")).toBe(200);
  });

  it("puts every column back", () => {
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));
    act(() => result.current.setWidth("client", 320));

    act(() => result.current.reset());

    expect(result.current.widthOf("client")).toBe(200);
    expect(storedWidths("jobs")).toEqual({});
  });

  // Колонку не можна звузити в нитку або розтягнути на весь екран: із першої
  // вже не вхопитись мишею, а друга ховає всі інші за горизонтальним скролом.
  it("refuses to shrink a column below what can be grabbed again", () => {
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));

    act(() => result.current.setWidth("client", 4));

    expect(result.current.widthOf("client")).toBe(COLUMN_MIN_WIDTH);
  });

  it("caps a column the reader dragged across the screen", () => {
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));

    act(() => result.current.setWidth("client", 5000));

    expect(result.current.widthOf("client")).toBe(COLUMN_MAX_WIDTH);
  });

  it("falls back to the default for a column it has never heard of", () => {
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));

    expect(result.current.widthOf("nope")).toBe(COLUMN_MIN_WIDTH);
  });

  /**
   * Сховище переживає зміну коду: колонку могли прибрати, перейменувати, а
   * значення могло зіпсуватись. Жодне з цього не має ламати таблицю.
   */
  it("ignores a stored value that is not a usable number", () => {
    localStorage.setItem(
      "bitcrm.column-widths.jobs",
      JSON.stringify({ client: "wide", tech: null, city: 240 }),
    );
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));

    expect(result.current.widthOf("client")).toBe(200);
    expect(result.current.widthOf("tech")).toBe(170);
    expect(result.current.widthOf("city")).toBe(240);
  });

  it("ignores a stored blob that is not an object at all", () => {
    localStorage.setItem("bitcrm.column-widths.jobs", "[1,2,3]");
    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));

    expect(result.current.widthOf("client")).toBe(200);
  });

  it("survives a private window where storage throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { result } = renderHook(() => useColumnWidths("jobs", DEFAULTS));
    expect(result.current.widthOf("client")).toBe(200);
    act(() => result.current.setWidth("client", 320));
    expect(result.current.widthOf("client")).toBe(320);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
