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

    it("has no email option unless the account offers one", async () => {
      await passwordStep();

      expect(screen.queryByRole("button", { name: /email instead/i })).not.toBeInTheDocument();
    });

    // Security Center "Login sending options": the code may go to the
    // account's email as well — on request, beside the text.
    it("sends the code to the email instead when the account allows it, and signs in with it", async () => {
      renderForm();
      await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
      await userEvent.type(screen.getByLabelText("Password"), "mfa-email-pass");
      await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
      const code = await screen.findByLabelText(/code/i);

      await userEvent.click(screen.getByRole("button", { name: /email instead/i }));

      expect(await screen.findByText(/sent to b•••@x\.com/i)).toBeInTheDocument();
      await userEvent.type(code, "123456");
      await userEvent.click(screen.getByRole("button", { name: /verify/i }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
      expect(useAuthStore.getState().session?.idToken).toBe("id-tok");
    });
  });

  /**
   * Settings → Security Center, "Require Two-factor authentication": the
   * account insists and this person has no phone yet. Workiz's "Set up
   * two-factor authentication" step: the phone first, its code next, and only
   * then the app — the tokens wait on the server throughout.
   */
  describe("setting up two-factor authentication on the way in", () => {
    async function setupStep() {
      renderForm();
      await userEvent.type(screen.getByLabelText(/email/i), "new@b.com");
      await userEvent.type(screen.getByLabelText("Password"), "setup-pass");
      await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
      return screen.findByRole("heading", { name: /set up two-factor authentication/i });
    }

    it("asks for a phone instead of signing in", async () => {
      await setupStep();

      expect(screen.getByRole("textbox", { name: /phone/i })).toBeInTheDocument();
      expect(useAuthStore.getState().session).toBeNull();
      expect(replace).not.toHaveBeenCalled();
    });

    it("texts the phone, then takes its code and signs in", async () => {
      await setupStep();
      await userEvent.type(screen.getByRole("textbox", { name: /phone/i }), "5412830739");
      await userEvent.click(screen.getByRole("button", { name: /send code/i }));

      const code = await screen.findByLabelText(/code/i);
      expect(screen.getByText(/•••• 0739/)).toBeInTheDocument();
      await userEvent.type(code, "123456");
      await userEvent.click(screen.getByRole("button", { name: /verify/i }));

      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
      expect(useAuthStore.getState().session?.idToken).toBe("id-tok");
    });

    it("says so when the number is already a teammate's, and keeps asking", async () => {
      await setupStep();
      await userEvent.type(screen.getByRole("textbox", { name: /phone/i }), "5412830000");
      await userEvent.click(screen.getByRole("button", { name: /send code/i }));

      expect(await screen.findByText(/already on/i)).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: /phone/i })).toBeInTheDocument();
      expect(useAuthStore.getState().session).toBeNull();
    });

    it("goes back to the password", async () => {
      await setupStep();
      await userEvent.click(screen.getByRole("button", { name: /back/i }));

      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
      expect(useAuthStore.getState().mfaChallenge).toBeNull();
    });
  });
});
