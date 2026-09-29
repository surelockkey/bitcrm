import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginForm } from "./login-form";
import { useAuthStore } from "@/stores/auth-store";

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
      <LoginForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  useAuthStore.getState().clear();
});

describe("LoginForm", () => {
  it("signs in and navigates home on valid credentials", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "goodpass");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(useAuthStore.getState().session?.idToken).toBe("id-tok");
  });

  it("routes a first-login challenge to /set-password and stores the email", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/email/i), "new@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "temp-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/set-password"));
    expect(useAuthStore.getState().pendingEmail).toBe("new@b.com");
    expect(useAuthStore.getState().challengeSession).toBe("sess-123");
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("shows an error and does not navigate on bad credentials", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  describe("two-step sign-in", () => {
    async function passwordStep() {
      renderForm();
      await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
      await userEvent.type(screen.getByLabelText("Password"), "mfa-pass");
      await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
      return screen.findByLabelText(/code/i);
    }

    it("asks for the texted code instead of signing in, naming the masked phone", async () => {
      await passwordStep();

      expect(screen.getByText(/•••• 1234/)).toBeInTheDocument();
      expect(useAuthStore.getState().session).toBeNull();
      expect(replace).not.toHaveBeenCalled();
    });

    it("signs in with the right code", async () => {
      const code = await passwordStep();
      await userEvent.type(code, "123456");
      await userEvent.click(screen.getByRole("button", { name: /verify/i }));

      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
      expect(useAuthStore.getState().session?.idToken).toBe("id-tok");
    });

    it("says so for a wrong code and stays on the code step", async () => {
      const code = await passwordStep();
      await userEvent.type(code, "000000");
      await userEvent.click(screen.getByRole("button", { name: /verify/i }));

      expect(await screen.findByText(/not right/i)).toBeInTheDocument();
      expect(useAuthStore.getState().session).toBeNull();
      expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
    });

    it("texts the code again on request", async () => {
      await passwordStep();
      await userEvent.click(screen.getByRole("button", { name: /send again|resend/i }));

      expect(await screen.findByText(/sent again/i)).toBeInTheDocument();
    });

    it("goes back to the password", async () => {
      await passwordStep();
      await userEvent.click(screen.getByRole("button", { name: /back/i }));

      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
      expect(useAuthStore.getState().mfaChallenge).toBeNull();
    });
  });
});
