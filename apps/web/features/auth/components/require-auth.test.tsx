import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RequireAuth } from "./require-auth";
import { useAuthStore } from "@/stores/auth-store";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

const SESSION = {
  idToken: "id-tok",
  accessToken: "access-tok",
  refreshToken: "refresh-tok",
  expiresIn: 3600,
  obtainedAt: 0,
};

beforeEach(() => {
  replace.mockClear();
  useAuthStore.getState().clear();
});

describe("RequireAuth", () => {
  it("redirects to /login and hides children when there is no session", async () => {
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("renders children and does not redirect when authenticated", async () => {
    useAuthStore.setState({ session: SESSION });
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(await screen.findByText("secret")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
