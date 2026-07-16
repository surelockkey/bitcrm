import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AuthLayout from "./layout";
import { useAuthStore } from "@/stores/auth-store";

const replace = vi.fn();
let pathname = "/login";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
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
  pathname = "/login";
});

describe("AuthLayout", () => {
  it("bounces a signed-in user away from /login", async () => {
    pathname = "/login";
    useAuthStore.setState({ session: SESSION });
    render(<AuthLayout>
      <div>auth screen</div>
    </AuthLayout>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("renders auth screens for signed-out users without redirecting", async () => {
    pathname = "/login";
    render(<AuthLayout>
      <div>auth screen</div>
    </AuthLayout>);
    expect(await screen.findByText("auth screen")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  // A signed-in user resets their password from Profile, which routes here.
  // Bouncing them home strands the emailed code with nowhere to enter it.
  it("keeps a signed-in user on the reset-code screen", async () => {
    pathname = "/forgot-password/confirm";
    useAuthStore.setState({ session: SESSION });
    render(<AuthLayout>
      <div>enter reset code</div>
    </AuthLayout>);
    expect(await screen.findByText("enter reset code")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps a signed-in user on the request-a-code screen", async () => {
    pathname = "/forgot-password";
    useAuthStore.setState({ session: SESSION });
    render(<AuthLayout>
      <div>request a code</div>
    </AuthLayout>);
    expect(await screen.findByText("request a code")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
