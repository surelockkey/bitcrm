import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PAGE_SIZES, usePageSize } from "./use-page-size";

/**
 * Скільки рядків показувати — вибір людини, а не програміста, і він має
 * пережити перезавантаження: диспетчер, що поставив 100, не хоче ставити їх
 * щоранку. Пам'ять — на список окремо: у роботах і в налаштуваннях різні
 * потреби.
 */
describe("usePageSize", () => {
  beforeEach(() => localStorage.clear());

  it("offers the sizes the backend can actually serve", () => {
    expect(PAGE_SIZES).toEqual([25, 50, 100]);
  });

  it("starts at fifty", () => {
    const { result } = renderHook(() => usePageSize("jobs"));

    expect(result.current[0]).toBe(50);
  });

  it("remembers the choice for next time", () => {
    const { result } = renderHook(() => usePageSize("jobs"));

    act(() => result.current[1](100));

    expect(result.current[0]).toBe(100);
    expect(renderHook(() => usePageSize("jobs")).result.current[0]).toBe(100);
  });

  it("keeps each list's choice apart", () => {
    const { result } = renderHook(() => usePageSize("jobs"));
    act(() => result.current[1](100));

    expect(renderHook(() => usePageSize("calls")).result.current[0]).toBe(50);
  });

  it("ignores a stored value that is not one of the offered sizes", () => {
    localStorage.setItem("bitcrm.page-size.jobs", "7");

    expect(renderHook(() => usePageSize("jobs")).result.current[0]).toBe(50);
  });

  it("still works where storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { result } = renderHook(() => usePageSize("jobs"));
    act(() => result.current[1](25));

    expect(result.current[0]).toBe(25);
    vi.restoreAllMocks();
  });
});
