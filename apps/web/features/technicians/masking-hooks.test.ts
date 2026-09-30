import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useSetClientNumberVisibility } from "./masking-hooks";

/**
 * Masking is written on one screen and read on others — the user's permissions
 * page, and the technician card that draws the switch. What is asserted here is
 * that the write actually reaches those readers: an invalidation aimed at a key
 * nobody stores under is a write that lands and a page that keeps showing the
 * answer from before it.
 */

const PROFILE = {
  userId: "u1",
  status: "active",
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function mockPermissionsApi() {
  server.use(
    http.get("*/users/u1/permissions", () =>
      HttpResponse.json({
        success: true,
        data: { roleId: "role-technician", permissions: {}, hasOverrides: false },
      }),
    ),
    http.put("*/users/u1/permissions", () =>
      HttpResponse.json({ success: true, data: { id: "u1" } }),
    ),
  );
}

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "QueryWrapper";
  return Wrapper;
}

describe("useSetClientNumberVisibility", () => {
  it("invalidates the queries the app really keeps this answer under", async () => {
    mockPermissionsApi();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Both readers are already on screen, holding the pre-flip answer.
    client.setQueryData(queryKeys.users.permissions("u1"), { hasOverrides: false });
    client.setQueryData(queryKeys.technicians.profile("u1"), PROFILE);

    const { result } = renderHook(() => useSetClientNumberVisibility(), {
      wrapper: wrapper(client),
    });
    result.current.mutate({ userId: "u1", hideNumbers: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => {
      expect(client.getQueryState(queryKeys.users.permissions("u1"))?.isInvalidated).toBe(true);
      expect(client.getQueryState(queryKeys.technicians.profile("u1"))?.isInvalidated).toBe(true);
    });
  });

  it("hides numbers by removing the grant, keeping overrides it knows nothing about", async () => {
    let sent: unknown;
    server.use(
      http.get("*/users/u1/permissions", () =>
        HttpResponse.json({
          success: true,
          data: {
            roleId: "role-technician",
            permissions: {},
            hasOverrides: true,
            overrides: { permissions: { deals: { delete: true }, contacts: { view: true } } },
          },
        }),
      ),
      http.put("*/users/u1/permissions", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ success: true, data: { id: "u1" } });
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSetClientNumberVisibility(), {
      wrapper: wrapper(client),
    });
    result.current.mutate({ userId: "u1", hideNumbers: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(sent).toMatchObject({
      permissions: {
        deals: { delete: true },
        contacts: { view: true, view_numbers: false },
      },
    });
  });
});
