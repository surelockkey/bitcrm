import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { update, perms, rules } = vi.hoisted(() => ({
  update: vi.fn(),
  perms: { edit: true },
  rules: { updateJobEndTimeOnClose: true },
}));

vi.mock("../hooks", () => ({
  useJobRules: () => ({ data: rules, isLoading: false, isSuccess: true, status: "success", fetchStatus: "idle" }),
  useUpdateJobRules: () => ({ mutate: update, isPending: false }),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (_r: string, action: string) => (action === "edit" ? perms.edit : true), isLoading: false }),
}));

import { AccountPreferencesPage } from "./account-preferences-page";

/**
 * Workiz's Account → "Account Preferences" (pg_settings_general_wz_account_scroll1):
 * the toggle rows under the h3. Ours holds the one that changes a job —
 * "Update Job End Time" — with Workiz's words and hint; a flip saves at once.
 */
describe("AccountPreferencesPage — Settings → Account Preferences", () => {
  beforeEach(() => {
    update.mockReset();
    perms.edit = true;
    rules.updateJobEndTimeOnClose = true;
  });

  it("shows Update Job End Time with Workiz's hint, as the account has it", () => {
    render(<AccountPreferencesPage />);
    // The band names the page; Workiz's h3 names the block of rows under it.
    expect(screen.getByRole("heading", { level: 3, name: "Account Preferences" })).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Update Job End Time" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Auto update the job end time on job done or canceled.")).toBeInTheDocument();
  });

  it("flipping it saves the rule at once", () => {
    render(<AccountPreferencesPage />);
    fireEvent.click(screen.getByRole("switch", { name: "Update Job End Time" }));
    expect(update).toHaveBeenCalledWith({ updateJobEndTimeOnClose: false });
  });

  it("someone who may only look sees it locked", () => {
    perms.edit = false;
    render(<AccountPreferencesPage />);
    expect(screen.getByRole("switch", { name: "Update Job End Time" })).toBeDisabled();
  });
});
