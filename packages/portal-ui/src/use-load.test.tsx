import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLoad } from "./use-load";

describe("useLoad", () => {
  it("loads, then reloads on demand after a failure", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue("ok");
    const { result } = renderHook(() => useLoad(load, "k"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe("ok"));
    expect(result.current.error).toBeUndefined();
  });

  it("never shows one key's data under another", async () => {
    const load = vi.fn(async () => "a");
    const { result, rerender } = renderHook(({ k }) => useLoad(load, k), { initialProps: { k: "one" } });
    await waitFor(() => expect(result.current.data).toBe("a"));
    load.mockImplementation(async () => "b");
    rerender({ k: "two" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe("b"));
  });
});
