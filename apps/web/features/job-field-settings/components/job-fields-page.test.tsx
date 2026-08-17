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
    data: { requiredFields: { address: true, jobType: true, source: false, poNumber: false } },
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
  usePermissions: () => ({ can: (_r: string, action: string) => (action === "edit" ? perms.edit : true) }),
}));

import { JobFieldsPage } from "./job-fields-page";

describe("JobFieldsPage — Settings → Job Fields", () => {
  beforeEach(() => {
    updateSettings.mockReset();
    updateCustomField.mockReset();
    perms.edit = true;
  });

  it("lists every built-in job field with its required state", () => {
    render(<JobFieldsPage />);

    expect(screen.getByRole("switch", { name: "Service address" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Job source" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "PO number" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Client phone" })).toBeInTheDocument();
  });

  it("toggling a built-in field saves the new requirement map", () => {
    render(<JobFieldsPage />);

    fireEvent.click(screen.getByRole("switch", { name: "Job source" }));

    expect(updateSettings).toHaveBeenCalledWith({
      requiredFields: expect.objectContaining({ source: true, address: true }),
    });
  });

  it("lists custom fields and toggles their own required flag", () => {
    render(<JobFieldsPage />);

    fireEvent.click(screen.getByRole("switch", { name: "Gate Code" }));

    expect(updateCustomField).toHaveBeenCalledWith(
      expect.objectContaining({ required: true }),
    );
  });

  it("read-only users see the switches disabled", () => {
    perms.edit = false;
    render(<JobFieldsPage />);

    expect(screen.getByRole("switch", { name: "Job source" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Gate Code" })).toBeDisabled();
  });
});
