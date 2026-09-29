import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetPasswordForm } from "./set-password-form";
import { useAuthStore } from "@/stores/auth-store";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

function renderForm() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SetPasswordForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  useAuthStore.getState().clear();
});

describe("SetPasswordForm", () => {
  // Setting a first password signs the person in; an account with two-step
  // sign-in on still has to bring the texted code.
  it("hands a two-step challenge to the login page's code step", async () => {
    server.use(
      http.post("*/users/auth/change-password", () =>
        HttpResponse.json({
          success: true,
          data: { challengeName: "SMS_MFA", session: "mfa-9", destination: "•••• 9876" },
        }),
      ),
    );
    useAuthStore.getState().setChallenge("new@b.com", "sess-123");
    renderForm();

    await userEvent.type(screen.getByLabelText("New password"), "Password1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "Password1");
    await userEvent.click(screen.getByRole("button", { name: /set password|save|continue/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(useAuthStore.getState().mfaChallenge).toEqual({ session: "mfa-9", destination: "•••• 9876" });
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("asks only for a new password and confirmation (no temporary password)", () => {
    useAuthStore.getState().setChallenge("new@b.com", "sess-123");
    renderForm();

    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(screen.queryByLabelText(/temporary password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it("answers the challenge and signs in on a valid new password", async () => {
    useAuthStore.getState().setChallenge("new@b.com", "sess-123");
    renderForm();

    await userEvent.type(screen.getByLabelText("New password"), "Password1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "Password1");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(useAuthStore.getState().session?.idToken).toBe("id-tok");
  });

  it("redirects to /login when there is no active challenge", async () => {
    renderForm();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
