import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { useMergeContacts } from "./hooks";

function wrapper(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

const merged = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.MANUAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

describe("useMergeContacts", () => {
  it("POSTs the merge body and invalidates contacts, companies and deals", async () => {
    let body: unknown;
    server.use(
      http.post("*/crm/contacts/merge", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: merged });
      }),
    );

    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMergeContacts(), { wrapper: wrapper(client) });

    act(() => result.current.mutate({ primaryId: "c1", mergeIds: ["c2", "c3"] }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(body).toEqual({ primaryId: "c1", mergeIds: ["c2", "c3"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["contacts"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["companies"] });
    // The duplicates' deals are re-pointed to the survivor server-side.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deals"] });
  });
});
