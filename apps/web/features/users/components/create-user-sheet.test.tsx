import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateUserSheet } from "./create-user-sheet";

/**
 * Workiz's "Add team member" (subcontractor_wz_04b_add_new_subcontractor):
 * a User | Subcontractor switch on top. A User "Can login and work on your
 * account" and gets a role; a Subcontractor "Can not login, can take jobs and
 * get messages" — no role, no invitation, "Add user".
 */

const fx = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("../hooks", () => ({
  useCreateUser: () => ({ mutate: fx.mutate, isPending: false }),
}));
vi.mock("../use-can-manage", () => ({
  useHierarchy: () => ({
    roles: [{ id: "role-dispatcher", name: "Dispatcher" }],
    assignableRoles: (roles: unknown[]) => roles,
  }),
}));

beforeEach(() => fx.mutate.mockReset());

const fill = async () => {
  await userEvent.type(screen.getByLabelText("First name"), "Tyler");
  await userEvent.type(screen.getByLabelText("Last name"), "Smith");
  await userEvent.type(screen.getByLabelText("Email"), "sandhill@example.com");
  await userEvent.type(screen.getByLabelText("Department"), "Field");
};

describe("CreateUserSheet — User | Subcontractor", () => {
  it("opens on User: a role to pick, an invitation to send", () => {
    render(<CreateUserSheet open onOpenChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "User" })).toBeChecked();
    expect(screen.getByText("Can login and work on your account")).toBeInTheDocument();
    expect(screen.getByText("Role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
  });

  it("a subcontractor is asked no role and gets no invitation", async () => {
    render(<CreateUserSheet open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "Subcontractor" }));

    expect(screen.getByText("Can not login, can take jobs and get messages")).toBeInTheDocument();
    expect(screen.queryByText("Role")).toBeNull();
    expect(screen.getByRole("button", { name: "Add user" })).toBeInTheDocument();

    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await waitFor(() => expect(fx.mutate).toHaveBeenCalled());
    const body = fx.mutate.mock.calls[0][0];
    expect(body).toMatchObject({ userType: "subcontractor", firstName: "Tyler", email: "sandhill@example.com" });
    expect("roleId" in body).toBe(false);
  });

  it("a User still needs a role", async () => {
    render(<CreateUserSheet open onOpenChange={() => {}} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Role" })).toHaveAttribute("aria-invalid", "true"),
    );
    expect(fx.mutate).not.toHaveBeenCalled();
  });
});
