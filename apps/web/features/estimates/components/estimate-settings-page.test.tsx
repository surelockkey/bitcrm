import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { DEFAULT_ESTIMATE_SETTINGS } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ perms: new Set(["settings.view", "settings.edit"]) }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`), isLoading: false }),
  useDenied: () => (r: string, a = "view") => !mocks.perms.has(`${r}.${a}`),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { EstimateSettingsPage } from "./estimate-settings-page";

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
let put: Record<string, unknown> | undefined;

function settings(over: Record<string, unknown> = {}, putStatus = 200) {
  server.use(
    http.get("*/billing/estimate-settings", () =>
      HttpResponse.json({ success: true, data: { ...DEFAULT_ESTIMATE_SETTINGS, ...over } }),
    ),
    http.put("*/billing/estimate-settings", async ({ request }) => {
      put = (await request.json()) as Record<string, unknown>;
      if (putStatus >= 400) {
        return HttpResponse.json({ success: false, error: { code: "ERR", message: "Could not save" } }, { status: putStatus });
      }
      return HttpResponse.json({ success: true, data: { ...DEFAULT_ESTIMATE_SETTINGS, ...over, ...put } });
    }),
  );
}

beforeEach(() => {
  put = undefined;
  mocks.perms = new Set(["settings.view", "settings.edit"]);
  toast.success.mockClear();
  toast.error.mockClear();
  settings();
});

/**
 * Settings → Estimates, Workiz's page (`settings_audit_wz_estimates_settings_v3`):
 * the title, "Customize template" at the right, and the switches we act on,
 * each saved on the click as Workiz's are.
 */
describe("EstimateSettingsPage", () => {
  it("refuses anyone without settings.view", () => {
    mocks.perms = new Set([]);
    renderWithClient(<EstimateSettingsPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("shows Workiz's words and the account's switches, both on", async () => {
    renderWithClient(<EstimateSettingsPage />);
    expect(await screen.findByRole("switch", { name: "Attach PDF files" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Auto-decline estimates related to the same job" })).toBeChecked();
    expect(screen.getByRole("heading", { name: "Estimates settings" })).toBeInTheDocument();
    expect(screen.getByText("Send your clients PDF copy of estimates")).toBeInTheDocument();
    expect(
      screen.getByText(
        "When enabled, approving one estimate will automatically decline all others for that job. When disabled, other estimates remain pending.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /customize template/i })).toHaveAttribute("href", "/settings/documents/tpl-default-estimate");
    // Workiz's other four rows are not ours to switch: no dead controls.
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("saves a switch the moment it is clicked, that switch alone", async () => {
    const u = user();
    renderWithClient(<EstimateSettingsPage />);
    await u.click(await screen.findByRole("switch", { name: "Attach PDF files" }));
    await waitFor(() => expect(put).toEqual({ attachPdf: false }));
    expect(screen.getByRole("switch", { name: "Attach PDF files" })).not.toBeChecked();
    expect(toast.success).toHaveBeenCalledWith("Estimates settings saved");
  });

  it("puts a refused switch back and says why", async () => {
    settings({}, 500);
    const u = user();
    renderWithClient(<EstimateSettingsPage />);
    await u.click(await screen.findByRole("switch", { name: "Auto-decline estimates related to the same job" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save"));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Auto-decline estimates related to the same job" })).toBeChecked(),
    );
  });

  it("is read-only without settings.edit", async () => {
    mocks.perms = new Set(["settings.view"]);
    renderWithClient(<EstimateSettingsPage />);
    expect(await screen.findByRole("switch", { name: "Attach PDF files" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Auto-decline estimates related to the same job" })).toBeDisabled();
  });
});
