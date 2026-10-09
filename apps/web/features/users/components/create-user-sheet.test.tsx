import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateUserSheet } from "./create-user-sheet";

/**
 * Workiz's "Add team member" pane (subcontractor_wz_04_add_new_user / _04b):
 * a User | Subcontractor switch on top. A User "Can login and work on your
 * account": Email Address · Name · +1 Phone · Permission level · Field tech
 * · Track Location, "Invite user"; a Subcontractor "Can not login, can take
 * jobs and get messages" — Email Address · Name · Phone, no role, no
 * invitation, "Add user". Ours, last: Department.
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
  await userEvent.type(screen.getByLabelText("Email Address"), "sandhill@example.com");
  await userEvent.type(screen.getByLabelText("Name"), "Tyler Smith");
  await userEvent.type(screen.getByLabelText("Department"), "Field");
};

/** Each named control stands before the next in the pane. */
const inOrder = (names: string[]) => {
  const els = names.map((n) => screen.getByLabelText(n));
  for (let i = 1; i < els.length; i++) {
    expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${names[i - 1]} before ${names[i]}`).toBeTruthy();
  }
};

describe("CreateUserSheet — User | Subcontractor", () => {
  it("opens on User with Workiz's fields in Workiz's order, Field tech and Track Location on, and 'Invite user'", () => {
    render(<CreateUserSheet open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Add team member" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "User" })).toBeChecked();
    expect(screen.getByText("Can login and work on your account")).toBeInTheDocument();
    inOrder(["Email Address", "Name", "Phone", "Permission level", "Field tech", "Track Location", "Department"]);
    expect(screen.getByText("An invitation will be sent to this email")).toBeInTheDocument();
    expect(screen.getByText("What can this user see and do on your account")).toBeInTheDocument();
    expect(screen.getByText("Can this user be assigned to jobs")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Field tech" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Track Location" })).toBeInTheDocument();
    // Both open on Yes, as Workiz's (the chosen value is drawn beside the floated label).
    expect(screen.getAllByText("Yes")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Invite user" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // Workiz's pane: no sentence under the title, no First / Last name boxes.
    expect(screen.queryByText(/temporary password/)).toBeNull();
    expect(screen.queryByLabelText("First name")).toBeNull();
    // Workiz's "Call masking" toggle stands between Phone and Permission level
    // (y377, its row 65px from Phone's foot to the next box). Masking is set
    // on the technician card here, so the row's room stays and the toggle does
    // not: a dead switch is worse than a gap (as the flows' smart callback row).
    const space = screen.getByRole("dialog").querySelector('[data-slot="call-masking-space"]');
    expect(space?.className).toContain("h-[35px]");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/call masking/i)).toBeNull();
  });

  it("invites a User with the split name, the role and both answers", async () => {
    render(<CreateUserSheet open onOpenChange={() => {}} />);
    await fill();
    await userEvent.click(screen.getByRole("combobox", { name: "Permission level" }));
    await userEvent.click(await screen.findByRole("option", { name: "Dispatcher" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Field tech" }));
    await userEvent.click(await screen.findByRole("option", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Invite user" }));
    await waitFor(() => expect(fx.mutate).toHaveBeenCalled());
    expect(fx.mutate.mock.calls[0][0]).toEqual({
      email: "sandhill@example.com",
      firstName: "Tyler",
      lastName: "Smith",
      roleId: "role-dispatcher",
      department: "Field",
      fieldTeamMember: false,
      gpsTrackingEnabled: true,
    });
  });

  it("a subcontractor is asked no role, Field tech or Track Location, and gets no invitation", async () => {
    render(<CreateUserSheet open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "Subcontractor" }));

    expect(screen.getByText("Can not login, can take jobs and get messages")).toBeInTheDocument();
    expect(screen.queryByText("Permission level")).toBeNull();
    expect(screen.queryByLabelText("Field tech")).toBeNull();
    expect(screen.queryByLabelText("Track Location")).toBeNull();
    inOrder(["Email Address", "Name", "Phone", "Department"]);
    expect(screen.getByRole("button", { name: "Add user" })).toBeInTheDocument();
    // The pane must not promise an invitation to someone who gets none.
    expect(screen.getByRole("heading", { name: "Add team member" })).toBeInTheDocument();
    expect(screen.queryByText(/temporary password/)).toBeNull();
    expect(screen.queryByText("An invitation will be sent to this email")).toBeNull();
    expect(screen.getByText(/job details reach them by text or email/)).toBeInTheDocument();

    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await waitFor(() => expect(fx.mutate).toHaveBeenCalled());
    const body = fx.mutate.mock.calls[0][0];
    expect(body).toMatchObject({ userType: "subcontractor", firstName: "Tyler", lastName: "Smith", email: "sandhill@example.com" });
    expect("roleId" in body).toBe(false);
    expect("fieldTeamMember" in body).toBe(false);
  });

  it("a User still needs a role", async () => {
    render(<CreateUserSheet open onOpenChange={() => {}} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Invite user" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Permission level" })).toHaveAttribute("aria-invalid", "true"),
    );
    expect(fx.mutate).not.toHaveBeenCalled();
  });

  it("asks for a first and a last name in the one Name box", async () => {
    render(<CreateUserSheet open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Name"), "Tyler");
    await userEvent.click(screen.getByRole("button", { name: "Invite user" }));
    expect(await screen.findByText("Enter first and last name")).toBeInTheDocument();
    expect(fx.mutate).not.toHaveBeenCalled();
  });
});
