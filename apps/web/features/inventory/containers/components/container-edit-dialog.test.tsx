import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import type { Container, ContainerTemplate, UserContainer } from "@bitcrm/types";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;
type Query = { isLoading: boolean; isError: boolean; data: Container | undefined };

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  query: undefined as unknown as Query,
  queried: [] as string[],
  update: vi.fn(),
  templates: [] as ContainerTemplate[],
  archivedTemplate: undefined as ContainerTemplate | undefined,
  templateLookups: [] as string[],
  assignments: [] as UserContainer[],
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

vi.mock("@/features/inventory/templates/hooks", () => ({
  useContainerTemplates: () => ({ data: mocks.templates, isLoading: false, isSuccess: true, isError: false }),
  useContainerTemplate: (id: string | undefined, enabled: boolean) => {
    if (enabled && id) mocks.templateLookups.push(id);
    return { data: enabled && id ? mocks.archivedTemplate : undefined, isLoading: false, isError: false };
  },
}));

vi.mock("@/features/inventory/user-containers/hooks", () => ({
  useUserContainers: () => ({ data: mocks.assignments, isLoading: false, isError: false }),
  useUserNames: () => ({ names: new Map([["u2", "Pavlo Bondar"]]), isLoading: false }),
}));

import { ContainerEditDialog } from "./container-edit-dialog";

const VAN: Container = {
  id: "c1",
  name: "Van 1",
  description: "North route",
  technicianId: "t1",
  technicianName: "Alex Smith",
  department: "Locksmith",
  templateId: "tp1",
  status: InventoryStatus.ACTIVE,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const tpl = (id: string, name: string, status = InventoryStatus.ACTIVE): ContainerTemplate => ({
  id,
  name,
  items: [],
  status,
  createdAt: "",
  updatedAt: "",
});

const assignment = (userId: string, userName: string): UserContainer => ({
  userId,
  userName,
  access: UserContainerAccess.CONTAINER,
  containerId: "c1",
  limited: false,
  updatedAt: "",
});

beforeEach(() => {
  mocks.denied = new Set();
  mocks.query = { isLoading: false, isError: false, data: VAN };
  mocks.queried = [];
  mocks.update.mockReset();
  mocks.templates = [tpl("tp1", "Standard van"), tpl("tp2", "Lockout van")];
  mocks.archivedTemplate = undefined;
  mocks.templateLookups = [];
  mocks.assignments = [assignment("u1", "Taras Koval"), assignment("u2", "u2")];
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

  it("shows the current name, description, department, template and status", () => {
    open();
    expect(screen.getByLabelText("Name")).toHaveValue("Van 1");
    expect(screen.getByLabelText("Description")).toHaveValue("North route");
    expect(screen.getByLabelText("Department")).toHaveValue("Locksmith");
    expect(screen.getByRole("combobox", { name: "Template" })).toHaveTextContent("Standard van");
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

  it("picks another template, and No template clears it", async () => {
    open();
    // The van's template is among the active ones: nothing to look up.
    expect(mocks.templateLookups).toEqual([]);
    await userEvent.click(screen.getByRole("combobox", { name: "Template" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "No template",
      "Standard van",
      "Lockout van",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "Lockout van" }));
    await save();
    expect(mocks.update).toHaveBeenLastCalledWith({
      id: "c1",
      body: expect.objectContaining({ templateId: "tp2" }),
    });
  });

  it("sends templateId: null for No template", async () => {
    open();
    await userEvent.click(screen.getByRole("combobox", { name: "Template" }));
    await userEvent.click(await screen.findByRole("option", { name: "No template" }));
    await save();
    expect(mocks.update).toHaveBeenCalledWith({
      id: "c1",
      body: expect.objectContaining({ templateId: null }),
    });
  });

  // The server keeps a template the van already has, even once it's archived.
  it("keeps showing a template that has been archived since", () => {
    mocks.templates = [tpl("tp2", "Lockout van")];
    mocks.archivedTemplate = tpl("tp1", "Old standard", InventoryStatus.ARCHIVED);
    open();
    expect(mocks.templateLookups).toEqual(["tp1"]);
    expect(screen.getByRole("combobox", { name: "Template" })).toHaveTextContent("Old standard");
  });

  // Who works from the van is User containers' business now: several people
  // may share one, and reassigning is done there.
  it("shows who works from the van, read-only, and where to change it", () => {
    open();
    expect(screen.queryByText(/technician/i)).toBeNull();
    expect(screen.getByText("Pavlo Bondar, Taras Koval")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage in User containers" })).toHaveAttribute(
      "href",
      "/inventory/user-containers",
    );
  });

  it("no longer sends a technician", async () => {
    open();
    await userEvent.type(screen.getByLabelText("Name"), " X");
    await save();
    const body = mocks.update.mock.calls[0][0].body;
    expect(body).not.toHaveProperty("technicianId");
    expect(body).not.toHaveProperty("technicianName");
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
    expect(screen.getByRole("combobox", { name: "Template" })).toBeDisabled();
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

  it("has its footer in place while it loads", () => {
    mocks.query = { isLoading: true, isError: false, data: undefined };
    open();
    expect(screen.getByTestId("dialog-footer-placeholder")).toBeInTheDocument();
  });

  it("says the van is gone when it can't be read", () => {
    mocks.query = { isLoading: false, isError: true, data: undefined };
    open();
    expect(screen.getByRole("dialog", { name: "Container not found" })).toBeInTheDocument();
  });
});
