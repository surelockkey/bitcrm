import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import type { InboxConversation } from "./api";
import { usePartyNames } from "./hooks";
import { mergeIncludedNames } from "./lib";

/**
 * The inbox's names travel with its pages (`included`), so a row is named on
 * its first frame. The old per-kind lookups remain only for a thread no page
 * has named — one that arrived live over the stream.
 */

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));

const conv = (id: string, extra: Partial<InboxConversation>): InboxConversation => ({
  id,
  kind: "client",
  partyKind: "none",
  addresses: { phones: ["+14045551234"], emails: [] },
  state: "open",
  unread: false,
  unreadCount: 0,
  flagged: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
  ...extra,
});

const jane = conv("c1", { partyKind: "contact", partyId: "ct1" });
const acme = conv("c2", { partyKind: "company", partyId: "co1" });
const bob = conv("c3", { kind: "team", partyKind: "user", partyId: "u1" });
const live = conv("c4", { partyKind: "contact", partyId: "ct9" });

const page = {
  success: true,
  data: [jane, acme, bob],
  pagination: { count: 3 },
  included: {
    contacts: [{ id: "ct1", name: "Jane Smith" }],
    companies: [{ id: "co1", name: "Acme Locks" }],
    users: [{ id: "u1", name: "Bob Ray" }],
  },
};

const asked: { path: string; body: unknown }[] = [];

beforeEach(() => {
  asked.length = 0;
  const record = async (path: string, request: Request) => {
    asked.push({ path, body: request.method === "POST" ? await request.json() : undefined });
  };
  server.use(
    http.post("*/crm/contacts/by-ids", async ({ request }) => {
      await record("contacts/by-ids", request);
      return HttpResponse.json({ success: true, data: [{ id: "ct9", firstName: "Live", lastName: "One", phones: [], emails: [], addresses: [] }] });
    }),
    http.post("*/crm/companies/by-ids", async ({ request }) => {
      await record("companies/by-ids", request);
      return HttpResponse.json({ success: true, data: [] });
    }),
    http.post("*/users/by-ids", async ({ request }) => {
      await record("users/by-ids", request);
      return HttpResponse.json({ success: true, data: [] });
    }),
    http.get("*/users", async ({ request }) => {
      await record("users (directory)", request);
      return HttpResponse.json({ success: true, data: [], pagination: { count: 0 } });
    }),
  );
});

function seeded() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.messaging.conversationList({ view: "all" }), {
    pages: [page],
    pageParams: [undefined],
  });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

describe("usePartyNames", () => {
  it("names every row from the pages' side-load on the first render, asking nobody", async () => {
    const { wrapper } = seeded();

    const { result } = renderHook(() => usePartyNames([jane, acme, bob]), { wrapper });

    expect(result.current.contacts.get("ct1")).toBe("Jane Smith");
    expect(result.current.companies.get("co1")).toBe("Acme Locks");
    expect(result.current.users.get("u1")).toBe("Bob Ray");
    // Give any stray request a chance to go out before saying none did.
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toEqual([]);
  });

  it("names a thread opened from the list the same way — the header of the open conversation", () => {
    const { wrapper } = seeded();

    const { result } = renderHook(() => usePartyNames([bob]), { wrapper });

    expect(result.current.users.get("u1")).toBe("Bob Ray");
  });

  it("asks crm only for the thread no page has named", async () => {
    const { wrapper } = seeded();

    const { result } = renderHook(() => usePartyNames([jane, live]), { wrapper });

    await waitFor(() => expect(result.current.contacts.get("ct9")).toBe("Live One"));
    expect(asked).toEqual([{ path: "contacts/by-ids", body: { ids: ["ct9"] } }]);
  });

  // The whole user directory is hundreds of rows; a teammate's name is one.
  it("names a missing teammate by id, never by loading the whole directory", async () => {
    const { wrapper } = seeded();
    const carol = conv("c5", { kind: "team", partyKind: "user", partyId: "u7" });

    renderHook(() => usePartyNames([carol]), { wrapper });

    await waitFor(() => expect(asked.map((a) => a.path)).toContain("users/by-ids"));
    expect(asked.find((a) => a.path === "users/by-ids")?.body).toEqual({ userIds: ["u7"] });
    expect(asked.map((a) => a.path)).not.toContain("users (directory)");
  });
});

describe("mergeIncludedNames", () => {
  it("merges the side-load of every page into lookups", () => {
    const names = mergeIncludedNames([page, { included: { contacts: [{ id: "ct2", name: "Tom Lee" }], companies: [], users: [] } }]);

    expect(names.contacts).toEqual(new Map([["ct1", "Jane Smith"], ["ct2", "Tom Lee"]]));
    expect(names.companies.get("co1")).toBe("Acme Locks");
    expect(names.users.get("u1")).toBe("Bob Ray");
  });

  it("tolerates pages without a side-load — an older deploy, or a list patched in the cache", () => {
    const names = mergeIncludedNames([{}, undefined as never, page]);

    expect(names.contacts.get("ct1")).toBe("Jane Smith");
  });
});
