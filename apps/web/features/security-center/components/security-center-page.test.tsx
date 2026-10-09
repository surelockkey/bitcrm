import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { DEFAULT_SECURITY_SETTINGS } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ perms: new Set(["settings.view", "settings.edit"]) }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`) }),
  // This suite asserts the refusal, so `useDenied` mirrors its own `can`.
  useDenied: () => (r: string, a = "view") => !mocks.perms.has(`${r}.${a}`),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { SecurityCenterPage } from "./security-center-page";

/**
 * Settings → Security Center, Workiz's (`feat_security_wz_security`): the
 * title, "Two-factor authentication (2FA)" with its line, and three rows
 * with the switch before the words — Require Two-factor authentication,
 * Login sending options, OTP sending options. A switch saves the moment it
 * is flipped (Workiz has no Save here); only `settings.edit` may flip one.
 */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });
let put: Record<string, unknown> | undefined;
let putStatus = 200;

function settings(over: Record<string, unknown> = {}) {
  server.use(
    http.get("*/users/security-settings", () =>
      HttpResponse.json({ success: true, data: { ...DEFAULT_SECURITY_SETTINGS, ...over } }),
    ),
    http.put("*/users/security-settings", async ({ request }) => {
      put = (await request.json()) as Record<string, unknown>;
      if (putStatus !== 200) {
        return HttpResponse.json(
          { success: false, message: "Codes by email are not set up on this server (MESSAGING_EMAIL_FROM). The switch stays off." },
          { status: putStatus },
        );
      }
      return HttpResponse.json({ success: true, data: { ...DEFAULT_SECURITY_SETTINGS, ...over, ...put } });
    }),
  );
}

const requireRow = () => screen.findByRole("switch", { name: "Require Two-factor authentication (2FA)" });

beforeEach(() => {
  put = undefined;
  putStatus = 200;
  mocks.perms = new Set(["settings.view", "settings.edit"]);
  toast.success.mockClear();
  toast.error.mockClear();
  settings();
});

describe("SecurityCenterPage", () => {
  it("refuses anyone without settings.view", () => {
    mocks.perms = new Set([]);
    renderWithClient(<SecurityCenterPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("is Workiz's page: the title, the 2FA section and its three rows, in its words", async () => {
    renderWithClient(<SecurityCenterPage />);

    expect(await requireRow()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("heading", { name: "Security center" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Two-factor authentication (2FA)" })).toBeInTheDocument();
    expect(screen.getByText(/adding an extra step to the login process/i)).toBeInTheDocument();
    expect(screen.getByText(/required to use 2FA to log in with a one-time code from your phone/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Login sending options" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/email message with a verification code when you log in/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "OTP sending options" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/in-app authentication \(e\.g\., when exporting data\)/i)).toBeInTheDocument();
    // Workiz's help link and its Support PIN code are its own — not drawn.
    expect(screen.queryByText(/learn more/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/support pin/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("reads the account's switches as stored", async () => {
    settings({ requireMfa: true, otpByEmail: true });
    renderWithClient(<SecurityCenterPage />);

    expect(await requireRow()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Login sending options" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "OTP sending options" })).toHaveAttribute("aria-checked", "true");
  });

  it("saves a switch the moment it is flipped — that switch alone", async () => {
    const u = user();
    renderWithClient(<SecurityCenterPage />);

    await u.click(await requireRow());

    await waitFor(() => expect(put).toEqual({ requireMfa: true }));
    expect(await requireRow()).toHaveAttribute("aria-checked", "true");
    expect(toast.success).toHaveBeenCalled();
  });

  it("flips back and says why when the server refuses — the email option needs a sender", async () => {
    const u = user();
    putStatus = 400;
    renderWithClient(<SecurityCenterPage />);

    await u.click(await screen.findByRole("switch", { name: "Login sending options" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/not set up on this server/i)));
    expect(screen.getByRole("switch", { name: "Login sending options" })).toHaveAttribute("aria-checked", "false");
  });

  it("shows the switches read-only to someone who may view settings but not edit them", async () => {
    mocks.perms = new Set(["settings.view"]);
    renderWithClient(<SecurityCenterPage />);

    expect(await requireRow()).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Login sending options" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "OTP sending options" })).toBeDisabled();
  });
});
