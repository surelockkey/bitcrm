import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;
type Query = { isLoading: boolean; isError: boolean; data: Container | undefined };

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  query: undefined as unknown as Query,
  queried: [] as string[],
  update: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));

vi.mock("../hooks", () => ({
  useContainer: (id: string) => {
    mocks.queried.push(id);
    return mocks.query;
  },
  useUpdateContainer: () => ({
    isPending: false,
    mutate: ((vars, opts) => {
      mocks.update(vars);
      opts?.onSuccess?.();
    }) as Mutate,
  }),
}));

vi.mock("./technician-select", () => ({
  TechnicianSelect: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id?: string;
    value: string | null;
    onChange: (v: { id: string; name: string } | null) => void;
    disabled?: boolean;
  }) => (
    <div id={id}>
      <span data-testid="tech-value">{value ?? "none"}</span>
      <button type="button" disabled={disabled} onClick={() => onChange({ id: "t9", name: "Ann Lee" })}>
        pick-ann
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange(null)}>
        pick-none
      </button>
    </div>
  ),
}));

import { ContainerEditDialog } from "./container-edit-dialog";

const VAN: Container = {
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

beforeEach(() => {
  mocks.denied = new Set();
  mocks.query = { isLoading: false, isError: false, data: VAN };
  mocks.queried = [];
  mocks.update.mockReset();
});

function open() {
  const onOpenChange = vi.fn();
  render(<ContainerEditDialog containerId="c1" open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));

describe("ContainerEditDialog — the van's settings in a popup", () => {
  it("is a dialog titled Edit container, reading the van it was opened for", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Edit container" })).toBeInTheDocument();
    expect(mocks.queried).toContain("c1");
  });

  it("shows the current name, description, department, technician and status", () => {
    open();
    expect(screen.getByLabelText("Name")).toHaveValue("Van 1");
    expect(screen.getByLabelText("Description")).toHaveValue("North route");
    expect(screen.getByLabelText("Department")).toHaveValue("Locksmith");
    expect(screen.getByTestId("tech-value")).toHaveTextContent("t1");
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked();
  });

  it("saves the edited fields and closes", async () => {
    const { onOpenChange } = open();
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Van 2");
    const desc = screen.getByLabelText("Description");
    await userEvent.clear(desc);
    await userEvent.type(desc, "South route");
    await save();

    expect(mocks.update).toHaveBeenCalledWith({
      id: "c1",
      body: expect.objectContaining({ name: "Van 2", description: "South route", department: "Locksmith" }),
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves a technician reassignment", async () => {
    open();
    await userEvent.click(screen.getByText("pick-ann"));
    await save();
    expect(mocks.update).toHaveBeenCalledWith({
      id: "c1",
      body: expect.objectContaining({ technicianId: "t9", technicianName: "Ann Lee" }),
    });
  });

  it("saves null to unassign the technician", async () => {
    open();
    await userEvent.click(screen.getByText("pick-none"));
    await save();
    expect(mocks.update).toHaveBeenCalledWith({
      id: "c1",
      body: expect.objectContaining({ technicianId: null, technicianName: null }),
    });
  });

  it("archives the van by switching Active off", async () => {
    open();
    await userEvent.click(screen.getByRole("switch", { name: "Active" }));
    await save();
    expect(mocks.update).toHaveBeenCalledWith({
      id: "c1",
      body: expect.objectContaining({ status: InventoryStatus.ARCHIVED }),
    });
  });

  it("won't save a van without a name", async () => {
    open();
    await userEvent.clear(screen.getByLabelText("Name"));
    await save();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("just closes when nothing changed", async () => {
    const { onOpenChange } = open();
    await save();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Cancel closes without saving", async () => {
    const { onOpenChange } = open();
    await userEvent.type(screen.getByLabelText("Name"), " X");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ContainerEditDialog — without containers.edit", () => {
  it("is view-only: every field locked, Close instead of Save", async () => {
    mocks.denied.add("containers.edit");
    const { onOpenChange } = open();
    expect(screen.getByRole("dialog", { name: "Container" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByLabelText("Department")).toBeDisabled();
    expect(screen.getByText("pick-ann")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Active" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // The dialog's own X is also named Close; the footer one is the last.
    const closes = screen.getAllByRole("button", { name: "Close" });
    await userEvent.click(closes[closes.length - 1]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ContainerEditDialog — loading and missing", () => {
  it("shows a skeleton while the van loads", () => {
    mocks.query = { isLoading: true, isError: false, data: undefined };
    open();
    expect(screen.getByTestId("container-edit-loading")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("says the van is gone when it can't be read", () => {
    mocks.query = { isLoading: false, isError: true, data: undefined };
    open();
    expect(screen.getByRole("dialog", { name: "Container not found" })).toBeInTheDocument();
  });
});
