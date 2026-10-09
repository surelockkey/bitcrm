import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryKeys } from "@/lib/query-keys";

const api = vi.hoisted(() => ({
  listCallFlows: vi.fn(),
  updateCallFlow: vi.fn(),
}));
vi.mock("./call-flows-api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { useAssignNumberFlow } = await import("./call-flows-hooks");

const flows = [
  { id: "a", name: "A", numbers: ["+12035550100", "+12035550111"] },
  { id: "b", name: "B", numbers: ["+12035550122"] },
];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(queryKeys.telephony.callFlows(), flows);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, ...renderHook(() => useAssignNumberFlow(), { wrapper }) };
}

beforeEach(() => {
  api.updateCallFlow.mockReset().mockImplementation(async (id: string, body: unknown) => ({ id, ...(body as object) }));
  api.listCallFlows.mockReset().mockResolvedValue(flows);
});

describe("useAssignNumberFlow — the numbers list's Flow select", () => {
  it("lets go of the number on its old flow before the new flow takes it", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.mutateAsync({ number: "+12035550111", toFlowId: "b" });
    });
    expect(api.updateCallFlow.mock.calls).toEqual([
      ["a", { numbers: ["+12035550100"] }],
      ["b", { numbers: ["+12035550122", "+12035550111"] }],
    ]);
  });

  it("only takes the number off for Remove flow", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.mutateAsync({ number: "+12035550122", toFlowId: null });
    });
    expect(api.updateCallFlow.mock.calls).toEqual([["b", { numbers: [] }]]);
  });

  it("re-reads the flows once the move is made", async () => {
    const { result, qc } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ number: "+12035550100", toFlowId: "b" });
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.telephony.callFlows() }));
  });
});
