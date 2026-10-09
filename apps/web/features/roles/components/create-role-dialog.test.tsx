import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataScope, type Role } from "@bitcrm/types";
import { CreateRoleDialog } from "./create-role-dialog";

const push = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../use-role-access", () => ({ useRoleAccess: () => ({ myPriority: 80, amSuperAdmin: false }) }));
vi.mock("../hooks", () => ({ useCreateRole: () => ({ mutate, isPending: false }) }));

const role = (id: string, name: string, priority: number): Role => ({
  id,
  name,
  permissions: { deals: { view: true, edit: priority > 30 } },
  dataScope: { deals: DataScope.DEPARTMENT },
  dealStageTransitions: ["*->canceled"],
  isSystem: true,
  priority,
  createdAt: "",
  updatedAt: "",
});

const roles = [role("role-admin", "Admin", 80), role("role-dispatcher", "Dispatcher", 40), role("role-technician", "Technician", 20)];

/**
 * "Add New Role" as one of Workiz's settings modals (WzFormModal: 500px,
 * the 18px/600 title, Cancel / Save): a name, what it is for, the role to
 * copy from and where it ranks; Save makes it and opens its permissions.
 */
describe("CreateRoleDialog — Add New Role", () => {
  it("asks for the name, a description, the role to copy and the rank", () => {
    render(<CreateRoleDialog open onOpenChange={() => {}} roles={roles} />);
    expect(screen.getByRole("heading", { name: "Add New Role" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    // The highest role below yours, to start from.
    expect(screen.getByRole("combobox", { name: "Copy permissions from" })).toBeInTheDocument();
    expect(screen.getByText("Dispatcher")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rank" })).toBeInTheDocument();
  });

  it("will not save without a name", async () => {
    render(<CreateRoleDialog open onOpenChange={() => {}} roles={roles} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Name must be at least 2 characters")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("saves a copy of the chosen role at the chosen rank, then opens it", async () => {
    mutate.mockImplementation((_body, { onSuccess }) => onSuccess({ id: "role-new" }));
    const onOpenChange = vi.fn();
    render(<CreateRoleDialog open onOpenChange={onOpenChange} roles={roles} />);
    await userEvent.type(screen.getByLabelText("Name"), "Night Desk");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Night Desk",
        permissions: roles[1].permissions,
        dataScope: roles[1].dataScope,
        dealStageTransitions: roles[1].dealStageTransitions,
        priority: expect.any(Number),
      }),
      expect.anything(),
    );
    const priority = mutate.mock.calls[0][0].priority as number;
    expect(priority).toBeLessThan(80);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).toHaveBeenCalledWith("/admin/roles/role-new");
  });
});
