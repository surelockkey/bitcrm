import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { ContainerSettingsTab } from "./container-settings-tab";

const mutate = vi.fn();
vi.mock("../hooks", () => ({
  useUpdateContainer: () => ({ mutate, isPending: false }),
}));

const container: Container = {
  id: "c1",
  technicianId: "t1",
  technicianName: "Alex Smith",
  department: "Locksmith",
  status: InventoryStatus.ACTIVE,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ContainerSettingsTab", () => {
  beforeEach(() => mutate.mockClear());

  it("shows the current department and an active toggle", () => {
    render(<ContainerSettingsTab container={container} />);

    expect(screen.getByLabelText("Department")).toHaveValue("Locksmith");
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked();
  });

  it("saves the edited department", async () => {
    render(<ContainerSettingsTab container={container} />);

    const dep = screen.getByLabelText("Department");
    await userEvent.clear(dep);
    await userEvent.type(dep, "Locksmith North");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledWith({
      id: "c1",
      body: { department: "Locksmith North", status: InventoryStatus.ACTIVE },
    });
  });

  it("saves a deactivated status when the toggle is off", async () => {
    render(<ContainerSettingsTab container={container} />);

    await userEvent.click(screen.getByRole("switch", { name: "Active" }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledWith({
      id: "c1",
      body: { department: "Locksmith", status: InventoryStatus.ARCHIVED },
    });
  });

  it("is view-only without the edit permission", () => {
    render(<ContainerSettingsTab container={container} readOnly />);

    expect(screen.getByLabelText("Department")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Active" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();
  });
});
