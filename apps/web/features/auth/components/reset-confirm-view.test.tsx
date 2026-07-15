import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResetConfirmView } from "./reset-confirm-view";
import { useAuthStore } from "@/stores/auth-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("email=ada@bitcrm.test"),
}));

const SESSION = {
  idToken: "id-tok",
  accessToken: "access-tok",
  refreshToken: "refresh-tok",
  expiresIn: 3600,
  obtainedAt: 0,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useAuthStore.getState().clear();
});

/** Drive the code + password fields and submit. */
async function submitReset() {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox"), "123456");
  await user.type(screen.getByLabelText("New password"), "Str0ng!Passw0rd");
  await user.type(screen.getByLabelText("Confirm new password"), "Str0ng!Passw0rd");
  await user.click(screen.getByRole("button", { name: /reset password/i }));
}

describe("ResetConfirmView success state", () => {
  it("sends a signed-out user back to sign in", async () => {
    render(<ResetConfirmView />, { wrapper });
    await submitReset();

    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  // A signed-in user resets from Profile and stays signed in — telling them to
  // "sign in with your new password" and linking to /login is a dead end.
  it("sends a signed-in user back into the app, not to the login screen", async () => {
    useAuthStore.setState({ session: SESSION });
    render(<ResetConfirmView />, { wrapper });
    await submitReset();

    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /back to sign in/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to profile/i })).toHaveAttribute(
      "href",
      "/profile",
    );
  });
});
