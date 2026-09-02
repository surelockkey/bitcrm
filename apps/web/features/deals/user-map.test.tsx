import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUserMap } from "./hooks";

const mocks = vi.hoisted(() => ({
  canListUsers: true,
  fetchAllUsers: vi.fn(),
  getUserNames: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (resource: string, action?: string) =>
      resource === "users" && action === "view" ? mocks.canListUsers : true,
  }),
}));
vi.mock("@/features/technicians/api", () => ({
  fetchAllUsers: mocks.fetchAllUsers,
}));
vi.mock("@/features/users/api", () => ({
  getUserNames: mocks.getUserNames,
}));

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useUserMap", () => {
  beforeEach(() => {
    mocks.canListUsers = true;
    mocks.fetchAllUsers.mockReset().mockResolvedValue([
      { id: "u-1", firstName: "Nazarii", lastName: "Tech", email: "n@x.com" },
    ]);
    mocks.getUserNames.mockReset().mockResolvedValue([
      { id: "u-1", firstName: "Nazarii", lastName: "Tech" },
    ]);
  });

  it("lists the whole directory for a viewer who may", async () => {
    const { result } = renderHook(() => useUserMap(["u-1"]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.map.get("u-1")).toBeDefined());
    expect(mocks.fetchAllUsers).toHaveBeenCalled();
    expect(mocks.getUserNames).not.toHaveBeenCalled();
  });

  /**
   * The bug this exists for: a technician holds `users.view: false`, so the
   * directory call 403s, the map comes back empty, and every consumer renders
   * a raw uuid where a name should be.
   */
  it("resolves just the ids it was given for a viewer who may not", async () => {
    mocks.canListUsers = false;

    const { result } = renderHook(() => useUserMap(["u-1"]), { wrapper: wrapper() });

    await waitFor(() =>
      expect(result.current.map.get("u-1")?.firstName).toBe("Nazarii"),
    );
    expect(mocks.getUserNames).toHaveBeenCalledWith(["u-1"]);
    expect(mocks.fetchAllUsers).not.toHaveBeenCalled();
  });

  /** No ids means nothing to resolve — and nothing to enumerate. */
  it("asks for nothing when a restricted viewer supplies no ids", async () => {
    mocks.canListUsers = false;

    const { result } = renderHook(() => useUserMap(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.map.size).toBe(0);
    expect(mocks.getUserNames).not.toHaveBeenCalled();
    expect(mocks.fetchAllUsers).not.toHaveBeenCalled();
  });

  it("de-duplicates and sorts ids so the cache key is stable", async () => {
    mocks.canListUsers = false;

    renderHook(() => useUserMap(["u-2", "u-1", "u-2"]), { wrapper: wrapper() });

    await waitFor(() => expect(mocks.getUserNames).toHaveBeenCalled());
    expect(mocks.getUserNames).toHaveBeenCalledWith(["u-1", "u-2"]);
  });

  it("leaves the map empty rather than throwing when the lookup fails", async () => {
    mocks.canListUsers = false;
    mocks.getUserNames.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useUserMap(["u-1"]), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.map.size).toBe(0);
  });
});
