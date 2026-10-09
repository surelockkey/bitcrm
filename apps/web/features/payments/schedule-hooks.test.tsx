import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useRefreshScheduleOnTotal } from "./schedule-hooks";

/**
 * A schedule's dollars are its shares of the job total, worked out by billing
 * when it is read — so a job whose total moved (an item added, the tax
 * changed) has a schedule to read again.
 */
describe("useRefreshScheduleOnTotal", () => {
  it("asks for the schedule again when the job total changes, not on the first total", () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { rerender } = renderHook(({ total }) => useRefreshScheduleOnTotal("d1", total), {
      wrapper,
      initialProps: { total: 100 },
    });
    expect(invalidate).not.toHaveBeenCalled();
    rerender({ total: 100 });
    expect(invalidate).not.toHaveBeenCalled();
    rerender({ total: 150 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.payments.schedule("d1") });
  });
});
