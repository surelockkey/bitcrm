import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { useLogout, useLogin } from "./hooks";
import { useAuthStore } from "@/stores/auth-store";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

/** Seed the cache with a previous user's data, the way a live session would. */
function seedPrevUser(client: QueryClient) {
  client.setQueryData(["me"], { id: "admin-1", email: "admin@test.com" });
  client.setQueryData(["deals", "list", {}], [{ id: "d1" }]);
}

beforeEach(() => {
  replace.mockClear();
  useAuthStore.setState({ session: null, pendingEmail: null, challengeSession: null });
});

describe("useLogout", () => {
  it("wipes the query cache so the next user can't see the previous one's data", () => {
    const client = new QueryClient();
    seedPrevUser(client);
    useAuthStore.setState({
      session: {
        idToken: "t", accessToken: "a", refreshToken: "r", expiresIn: 3600, obtainedAt: 0,
      },
    });

    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(client) });
    act(() => result.current());

    expect(client.getQueryData(["me"])).toBeUndefined();
    expect(client.getQueryData(["deals", "list", {}])).toBeUndefined();
    expect(useAuthStore.getState().session).toBeNull();
    expect(replace).toHaveBeenCalledWith("/login");
  });
});

describe("useLogin", () => {
  it("clears a prior user's cache before starting the new session", async () => {
    server.use(
      http.post("*/users/auth/login", () =>
        HttpResponse.json({
          success: true,
          data: {
            idToken: "new-id", accessToken: "new-acc", refreshToken: "new-ref", expiresIn: 3600,
          },
        }),
      ),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedPrevUser(client);

    const { result } = renderHook(() => useLogin(), { wrapper: wrapper(client) });
    act(() => {
      result.current.mutate({ email: "tech@test.com", password: "pw" });
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(client.getQueryData(["me"])).toBeUndefined();
    expect(useAuthStore.getState().session?.idToken).toBe("new-id");
  });
});
