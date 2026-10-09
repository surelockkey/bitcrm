import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CustomFieldDefinition } from "@bitcrm/types";

const { updateSettings, updateCustomField, perms } = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  updateCustomField: vi.fn(),
  perms: { edit: true },
}));

vi.mock("../hooks", () => ({
  useJobFieldSettings: () => ({
    data: { requiredFields: { firstName: true, address: true, jobType: true, source: false, poNumber: false } },
    isLoading: false,
  }),
  useUpdateJobFieldSettings: () => ({ mutate: updateSettings, isPending: false }),
}));

vi.mock("@/features/custom-fields/hooks", () => ({
  useCustomFields: () => ({
    data: [
      {
        id: "cf-gate",
        name: "Gate Code",
        type: "text",
        group: "Access",
        options: [],
        jobTypeIds: [],
        required: false,
        requiredToClose: false,
        searchable: false,
        priority: 0,
        active: true,
        createdBy: "u1",
        createdAt: "",
        updatedAt: "",
      } as CustomFieldDefinition,
    ],
  }),
  useUpdateCustomField: () => ({ mutate: updateCustomField, isPending: false }),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: (_r: string, action: string) => (action === "edit" ? perms.edit : true) }),
}));

import { JobFieldsPage } from "./job-fields-page";

/**
 * Workiz's Field Validation (pg_settings_catalogs_wz_managefields): its rows
 * first, in its words and order — "First Name Required?" … "Job Address
 * Required" — then ours, then "Restore Default Settings".
 */
describe("JobFieldsPage — Settings → Field Validation", () => {
  beforeEach(() => {
    updateSettings.mockReset();
    updateCustomField.mockReset();
    perms.edit = true;
  });

  it("lists Workiz's rows first, in its words, with their required state", () => {
    render(<JobFieldsPage />);

    const names = screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label") ?? "");
    expect(names.slice(0, 9)).toEqual([
      "First Name Required?",
      "Last Name Required?",
      "Client Company Name Required?",
      "Primary Phone Required?",
      "Secondary Phone Required?",
      "Email Address Required?",
      "External Company or Ad Group Required?",
      "Client Address Required",
      "Job Address Required",
    ]);
    expect(screen.getByRole("switch", { name: "First Name Required?" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Job Address Required" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Job source Required?" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "PO number Required?" })).toBeInTheDocument();
    // Workiz's rows for fields its own New Job no longer has are not drawn as dead switches.
    expect(screen.queryByRole("switch", { name: /Payment Approval/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: /^Parts/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: /^Total/ })).toBeNull();
  });

  it("toggling a built-in field saves the new requirement map", () => {
    render(<JobFieldsPage />);

    fireEvent.click(screen.getByRole("switch", { name: "Job source Required?" }));

    expect(updateSettings).toHaveBeenCalledWith({
      requiredFields: expect.objectContaining({ source: true, address: true }),
    });
  });

  it("'Restore Default Settings' puts every row back to its default", () => {
    render(<JobFieldsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Restore Default Settings" }));

    expect(updateSettings).toHaveBeenCalledWith({
      requiredFields: expect.objectContaining({ firstName: false, address: true, jobType: true, source: false }),
    });
  });

  it("lists custom fields and toggles their own required flag", () => {
    render(<JobFieldsPage />);

    fireEvent.click(screen.getByRole("switch", { name: "Gate Code Required?" }));

    expect(updateCustomField).toHaveBeenCalledWith(
      expect.objectContaining({ required: true }),
    );
  });

  it("read-only users see the switches disabled and no restore", () => {
    perms.edit = false;
    render(<JobFieldsPage />);

    expect(screen.getByRole("switch", { name: "Job source Required?" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Gate Code Required?" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Restore Default Settings" })).toBeNull();
  });
});
