import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { DEFAULT_PAYMENT_SETTINGS } from "@bitcrm/types";
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

import { PaymentSettingsPage } from "./payment-settings-page";

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
let put: Record<string, unknown> | undefined;

function settings(over: Record<string, unknown> = {}) {
  server.use(
    http.get("*/billing/payment-settings", () =>
      HttpResponse.json({ success: true, data: { ...DEFAULT_PAYMENT_SETTINGS, stripeConfigured: true, ...over } }),
    ),
    http.put("*/billing/payment-settings", async ({ request }) => {
      put = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ success: true, data: { ...DEFAULT_PAYMENT_SETTINGS, ...put } });
    }),
  );
}

beforeEach(() => {
  put = undefined;
  mocks.perms = new Set(["settings.view", "settings.edit"]);
  toast.success.mockClear();
  settings();
});

describe("PaymentSettingsPage", () => {
  it("refuses anyone without settings.view", () => {
    mocks.perms = new Set([]);
    renderWithClient(<PaymentSettingsPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("opens with the account's settings, surcharging off", async () => {
    renderWithClient(<PaymentSettingsPage />);
    expect(await screen.findByLabelText(/accept payments online/i)).not.toBeChecked();
    expect(screen.getByLabelText(/surcharge percent/i)).toHaveValue("0");
    expect(screen.getByLabelText(/bank minimum/i)).toHaveValue("20");
  });

  it("spells out why a card surcharge is off by default", async () => {
    renderWithClient(<PaymentSettingsPage />);
    await screen.findByLabelText(/surcharge percent/i);
    expect(screen.getByText(/banned/i)).toBeInTheDocument();
    expect(screen.getByText(/3%/)).toBeInTheDocument();
  });

  it("says when Stripe keys are in place — and never shows one", async () => {
    renderWithClient(<PaymentSettingsPage />);
    expect(await screen.findByText(/stripe keys are set up/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sk_|pk_/);
  });

  it("says when the server has no Stripe keys", async () => {
    settings({ stripeConfigured: false });
    renderWithClient(<PaymentSettingsPage />);
    expect(await screen.findByText(/no stripe keys/i)).toBeInTheDocument();
  });

  it("saves the whole document when something changes", async () => {
    const u = user();
    renderWithClient(<PaymentSettingsPage />);
    await u.click(await screen.findByLabelText(/allow part payments/i));
    await u.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(put).toBeTruthy());
    expect(put).toMatchObject({ allowPartial: false, surchargePercent: 0, bankMinimum: 20 });
  });

  it("refuses a surcharge above the card-network cap", async () => {
    const u = user();
    renderWithClient(<PaymentSettingsPage />);
    const field = await screen.findByLabelText(/surcharge percent/i);
    await u.clear(field);
    await u.type(field, "5");
    await u.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/can't be more than 3%/i)).toBeInTheDocument();
    expect(put).toBeUndefined();
  });

  it("refuses online payments with no method turned on", async () => {
    settings({ cardEnabled: false, bankEnabled: false });
    const u = user();
    renderWithClient(<PaymentSettingsPage />);
    await u.click(await screen.findByLabelText(/accept payments online/i));
    await u.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/need at least one/i)).toBeInTheDocument();
    expect(put).toBeUndefined();
  });

  it("marks tips as coming soon and leaves them switched off", async () => {
    renderWithClient(<PaymentSettingsPage />);
    expect(await screen.findByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ask for a tip/i)).toBeDisabled();
  });

  it("is read-only without settings.edit", async () => {
    mocks.perms = new Set(["settings.view"]);
    renderWithClient(<PaymentSettingsPage />);
    expect(await screen.findByLabelText(/accept payments online/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });
});
