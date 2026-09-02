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

vi.mock("./technician-select", () => ({
  TechnicianSelect: ({
    value,
    onChange,
    disabled,
  }: {
    value: string | null;
    onChange: (v: { id: string; name: string } | null) => void;
    disabled?: boolean;
  }) => (
    <div>
      <span data-testid="tech-value">{value ?? "none"}</span>
      <button
        disabled={disabled}
        onClick={() => onChange({ id: "t9", name: "Ann Lee" })}
      >
        pick-ann
      </button>
      <button disabled={disabled} onClick={() => onChange(null)}>
        pick-none
      </button>
    </div>
  ),
}));

const container: Container = {
  id: "c1",
  name: "Van 1",
  description: "North route",
  technicianId: "t1",
  technicianName: "Alex Smith",
  department: "Locksmith",
  status: InventoryStatus.ACTIVE,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ContainerSettingsTab", () => {
  beforeEach(() => mutate.mockClear());

  it("shows the current name, description, department and assignment", () => {
    render(<ContainerSettingsTab container={container} />);

    expect(screen.getByLabelText("Name")).toHaveValue("Van 1");
    expect(screen.getByLabelText("Description")).toHaveValue("North route");
    expect(screen.getByLabelText("Department")).toHaveValue("Locksmith");
    expect(screen.getByTestId("tech-value")).toHaveTextContent("t1");
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked();
  });

  it("saves edited name and description", async () => {
    render(<ContainerSettingsTab container={container} />);

    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Van 2");
    const desc = screen.getByLabelText("Description");
    await userEvent.clear(desc);
    await userEvent.type(desc, "South route");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledWith({
      id: "c1",
      body: expect.objectContaining({ name: "Van 2", description: "South route" }),
    });
  });

  it("saves a technician reassignment", async () => {
    render(<ContainerSettingsTab container={container} />);

    await userEvent.click(screen.getByText("pick-ann"));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledWith({
      id: "c1",
      body: expect.objectContaining({
        technicianId: "t9",
        technicianName: "Ann Lee",
      }),
    });
  });

  it("saves null to unassign the technician", async () => {
    render(<ContainerSettingsTab container={container} />);

    await userEvent.click(screen.getByText("pick-none"));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledWith({
      id: "c1",
      body: expect.objectContaining({ technicianId: null }),
    });
  });

  it("is view-only without the edit permission", () => {
    render(<ContainerSettingsTab container={container} readOnly />);

    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByLabelText("Department")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Active" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();
  });
});
