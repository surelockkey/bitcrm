import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TechnicianDetailPage } from "./technician-detail-page";

/**
 * The card as Workiz's user page (pg_technicians_wz_10_user_profile): what is
 * asserted is the order a Workiz user reads it in, that nothing on it is drawn
 * dead, and that the API's edit rule is drawn where the API draws it.
 */

const state = vi.hoisted(() => ({
  canViewTechs: true,
  canEditTechs: true,
  isTechnician: false,
  canViewCommission: true,
  canViewDocuments: true,
  canViewJobTypes: true,
  canViewServiceAreas: true,
  canViewRoles: true,
  canEditUsers: true,
  canSendMessages: true,
  meId: "mgr-1",
}));

const fx = vi.hoisted(() => ({
  update: vi.fn(),
  updateUser: vi.fn(),
  setMfa: vi.fn(),
  setMasking: vi.fn(),
  uploadPhoto: vi.fn(),
  deletePhoto: vi.fn(),
  rolesEnabled: [] as boolean[],
  assignments: { jobTypes: [] as unknown[], serviceAreas: [] as unknown[] },
  smsMfaEnabled: false,
  userType: undefined as "subcontractor" | undefined,
  profile: {
    userId: "t1",
    phone: "+14045551234",
    additionalPhones: ["+14045550100"],
    technicianType: "regular" as const,
    homeAddress: { line1: "12 Oak St", city: "Phoenix", state: "AZ", zip: "85001" },
    laborCostPerHour: 45,
    callMaskingEnabled: false,
    gpsTrackingEnabled: true,
    mobileAppInstalled: false,
    status: "active" as const,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-09-17T00:00:00Z",
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    me: { id: state.meId, firstName: "Mo", lastName: "Grant", email: "mo@slk", roleId: "role-admin" },
    isTechnician: state.isTechnician,
    can: (resource: string, action = "view") => {
      switch (resource) {
        case "technicians":
          return action === "view" ? state.canViewTechs : state.canEditTechs;
        case "commission":
          return state.canViewCommission;
        case "documents":
          return state.canViewDocuments;
        case "job_types":
          return action === "view" && state.canViewJobTypes;
        case "service_areas":
          return action === "view" && state.canViewServiceAreas;
        case "users":
          return state.canEditUsers;
        case "roles":
          return state.canViewRoles;
        case "messages":
          return state.canSendMessages;
        default:
          return false;
      }
    },
  }),
}));

vi.mock("../hooks", () => ({
  useProfile: () => ({ data: fx.profile, isLoading: false, isError: false }),
  useUserMap: () => ({
    data: new Map([
      [
        "t1",
        {
          id: "t1",
          firstName: "Riley",
          lastName: "Santos",
          email: "riley@slk",
          roleId: "role-technician",
          smsMfaEnabled: fx.smsMfaEnabled,
          userType: fx.userType,
        },
      ],
    ]),
  }),
  useOnboarding: () => ({
    data: {
      status: "active",
      checklist: { profileComplete: true, assignmentsApproved: false, commissionSet: false },
      completedSteps: 1,
      totalSteps: 3,
    },
    isLoading: false,
  }),
  useAssignments: () => ({ data: fx.assignments, isLoading: false }),
  useUpdateProfile: () => ({ mutate: fx.update, isPending: false }),
  useUploadPhoto: () => ({ mutate: fx.uploadPhoto, isPending: false }),
  useDeletePhoto: () => ({ mutate: fx.deletePhoto, isPending: false }),
  useApproveAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useProposeAssignments: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignDirect: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The name, the field-team flag and two-step sign-in live on the user record
// and save through the users feature; only that the card reaches for it matters.
vi.mock("@/features/users/hooks", () => ({
  useUpdateUser: () => ({ mutate: fx.updateUser, isPending: false }),
  useSetUserMfa: () => ({ mutate: fx.setMfa, isPending: false }),
}));

vi.mock("../masking-hooks", () => ({
  useSetClientNumberVisibility: () => ({ mutate: fx.setMasking, isPending: false }),
}));

// Honours `enabled` the way the real hook does.
vi.mock("@/features/roles/hooks", () => ({
  useRoles: (enabled = true) => {
    fx.rolesEnabled.push(enabled);
    return { data: enabled ? [{ id: "role-technician", name: "Technician", priority: 20 }] : undefined };
  },
}));

vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [] }) }));
vi.mock("@/features/job-types/lib", () => ({ useJobTypesLoading: () => false, useJobTypeName: () => (id: string) => id }));

// Heavy neighbours, each with its own tests: only their presence matters here.
vi.mock("@/features/messaging/components/party-chat", () => ({
  PartyChat: ({ partyId }: { partyId: string }) => <div data-testid="party-chat" data-party={partyId} />,
}));
// Forwards what the card gives it and invents nothing.
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value, id, ariaLabel, placeholder }: { value: string; id?: string; ariaLabel?: string; placeholder?: string }) => (
    <input id={id} aria-label={ariaLabel} placeholder={placeholder} defaultValue={value} />
  ),
}));
vi.mock("./commission-tab", () => ({ CommissionTab: () => <div data-testid="commission-panel" /> }));
vi.mock("./documents-tab", () => ({ DocumentsTab: () => <div data-testid="documents-panel" /> }));

beforeEach(() => {
  state.canViewTechs = true;
  state.canEditTechs = true;
  state.isTechnician = false;
  state.canViewCommission = true;
  state.canViewDocuments = true;
  state.canViewJobTypes = true;
  state.canViewServiceAreas = true;
  state.canViewRoles = true;
  state.canEditUsers = true;
  state.canSendMessages = true;
  state.meId = "mgr-1";
  fx.update.mockReset();
  fx.updateUser.mockReset();
  fx.setMfa.mockReset();
  fx.setMasking.mockReset();
  fx.uploadPhoto.mockReset();
  fx.deletePhoto.mockReset();
  fx.rolesEnabled.length = 0;
  fx.assignments = { jobTypes: [], serviceAreas: [] };
  fx.smsMfaEnabled = false;
  fx.userType = undefined;
});

/** Index of a piece of text inside an element, for order assertions. */
const at = (el: HTMLElement, text: string) => {
  const i = (el.textContent ?? "").indexOf(text);
  expect(i, `"${text}" is missing`).toBeGreaterThan(-1);
  return i;
};
const inOrder = (el: HTMLElement, texts: string[]) => {
  const order = texts.map((t) => at(el, t));
  expect(order).toEqual([...order].sort((a, b) => a - b));
};
const openTab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));
const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));
const reason = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("TechnicianDetailPage — Workiz's user page", () => {
  it("is 'User Settings' with Workiz's tabs, ours (Documents) last, opening on Profile", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByRole("heading", { level: 2, name: "User Settings" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Profile", "Availability", "Commissions", "Documents"]);
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
  });

  it("draws the person column in Workiz's order", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    inOrder(screen.getByTestId("person-column"), [
      "Profile picture",
      "Track location",
      "User Details",
      "User type",
      "First name",
      "Email",
      "Home address",
      "Phone",
      "Additional phone",
      "Call masking",
      "Two-factor authentication",
    ]);
  });

  it("draws the work column in Workiz's order, with ours under a title of their own", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    inOrder(screen.getByTestId("work-column"), [
      "Roles and permissions",
      "Field team member",
      "Labor cost per hour",
      "Job types",
      "User skills",
      "Service areas",
      "Schedule color",
      "Technician status",
      "Status",
      "Mobile app installed",
      "Onboarding",
    ]);
  });

  it("carries no Role field, and never asks for the roles list", () => {
    // The role is set on the user record, with its confirmation and its reset
    // of overrides; the owner struck the copy from this card.
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(within(screen.getByTestId("work-column")).queryByText("Role")).toBeNull();
    expect(screen.queryByRole("link", { name: /customize roles and permissions/i })).toBeNull();
    expect(fx.rolesEnabled).toEqual([]);
  });

  it("draws nothing dead: Workiz's fields we hold no data for are left out", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    for (const words of ["Notes", "User signature", "Sync email", "Allowed IP", "Advanced", "same as business hours"]) {
      expect(screen.queryByText(new RegExp(words, "i")), words).toBeNull();
    }
  });

  it("carries the live values we hold into the form", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("Labor cost per hour")).toHaveValue(45);
    expect(screen.getByLabelText("City")).toHaveValue("Phoenix");
    expect(screen.getByLabelText("Home address")).toHaveValue("12 Oak St");
    expect(screen.getByRole("checkbox", { name: "Track location" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "User type" })).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
  });

  it("pins Workiz's Save bar under the form", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const bar = screen.getByRole("button", { name: "Save" }).closest("[data-slot=wz-action-bar]");
    expect(bar).not.toBeNull();
  });
});

describe("TechnicianDetailPage — the switches", () => {
  it("names the masking switch as Workiz does, and writes it at once", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const masking = screen.getByRole("switch", { name: "Call masking" });
    expect(reason(masking)).toMatch(/never the number/);
    await userEvent.click(masking);
    expect(fx.setMasking).toHaveBeenCalledWith({ userId: "t1", hideNumbers: true });
  });

  it("shows two-step sign-in as the user record has it, and switches it there, at once", async () => {
    fx.smsMfaEnabled = true;
    render(<TechnicianDetailPage technicianId="t1" />);
    const twoFactor = screen.getByRole("switch", { name: "Two-factor authentication" });
    expect(twoFactor).toBeChecked();
    await userEvent.click(twoFactor);
    expect(fx.setMfa).toHaveBeenCalledWith({ id: "t1", enabled: false });
  });

  it("locks two-step sign-in for a manager without users.edit, and says where it lives", () => {
    state.canEditUsers = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    const twoFactor = screen.getByRole("switch", { name: "Two-factor authentication" });
    expect(twoFactor).toBeDisabled();
    expect(reason(twoFactor)).toMatch(/user record/);
  });
});

// Workiz's user page for "(3) AZ - Tyler Smith Sub" (subcontractor_wz_05_user_profile):
// User type "Subcontractor", Track location and Two-factor authentication greyed —
// "Location tracking is only available for paid users"; a subcontractor cannot log in.
describe("TechnicianDetailPage — a subcontractor", () => {
  it("shows the person's type, and greys what a subcontractor cannot have", () => {
    fx.userType = "subcontractor";
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByRole("combobox", { name: "User type" })).toBeInTheDocument();
    expect(screen.getByText("Subcontractor")).toBeInTheDocument();

    const track = screen.getByRole("checkbox", { name: "Track location" });
    expect(track).toBeDisabled();
    expect(reason(track)).toMatch(/only available for users, not for subcontractors/);

    const twoFactor = screen.getByRole("switch", { name: "Two-factor authentication" });
    expect(twoFactor).toBeDisabled();
    expect(reason(twoFactor)).toMatch(/cannot sign in/);
  });

  it("choosing Subcontractor stops location tracking, and the save carries both", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByRole("checkbox", { name: "Track location" })).toBeChecked();

    await userEvent.click(screen.getByRole("combobox", { name: "User type" }));
    await userEvent.click(screen.getByRole("option", { name: "Subcontractor" }));

    const track = screen.getByRole("checkbox", { name: "Track location" });
    expect(track).not.toBeChecked();
    expect(track).toBeDisabled();

    await save();
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    expect(fx.update.mock.calls[0][0].body).toMatchObject({ technicianType: "subcontractor", gpsTrackingEnabled: false });
  });
});

describe("TechnicianDetailPage — the Availability tab", () => {
  it("saves the hours with the card once touched", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    await openTab("Availability");
    await userEvent.click(screen.getByRole("checkbox", { name: "Sat" }));
    await save();
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    expect(fx.update.mock.calls[0][0].body).toMatchObject({ workingDays: [1, 2, 3, 4, 5, 6], workStart: "08:00", workEnd: "17:00" });
  });

  it("leaves unset hours unset when the card is saved without touching them", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    await save();
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    const body = fx.update.mock.calls[0][0].body;
    expect(body.workingDays).toBeUndefined();
    expect(body.workStart).toBeUndefined();
  });

  it("is read-only for a viewer who may not set the hours", async () => {
    state.isTechnician = true;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);
    await openTab("Availability");
    expect(screen.getByRole("checkbox", { name: "Mon" })).toBeDisabled();
  });
});

describe("TechnicianDetailPage — the other tabs and Actions", () => {
  it("keeps commission and documents, each on its tab, and the form steps aside", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    await openTab("Commissions");
    expect(screen.getByTestId("commission-panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await openTab("Documents");
    expect(screen.getByTestId("documents-panel")).toBeInTheDocument();
  });

  it("hides the commission and documents tabs without their permissions", () => {
    state.canViewCommission = false;
    state.canViewDocuments = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("tab", { name: "Commissions" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Documents" })).toBeNull();
  });

  it("puts the team chat in Actions, for someone else's card", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Send a text" }));
    expect(screen.getByRole("dialog", { name: "Text Riley Santos" })).toBeInTheDocument();
    expect(screen.getByTestId("party-chat")).toHaveAttribute("data-party", "t1");
  });

  it("draws no Actions on one's own card, or for someone who may not send", () => {
    state.meId = "t1";
    const { unmount } = render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
    unmount();
    state.meId = "mgr-1";
    state.canSendMessages = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
  });

  it("has no way back in the header — the sidebar is the way back", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("button", { name: /technicians/i })).toBeNull();
  });
});

describe("TechnicianDetailPage — job types and service areas", () => {
  it("hides them without their view permissions", () => {
    state.canViewJobTypes = false;
    state.canViewServiceAreas = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByText("User skills")).toBeNull();
    expect(screen.queryByRole("group", { name: "Service areas" })).toBeNull();
  });

  it("draws an approved entry as Workiz's plain chip — the owner struck the green", () => {
    fx.assignments = {
      jobTypes: [{ jobTypeId: "jt-lockout", status: "approved", proposedBy: "m", proposedAt: "t" }],
      serviceAreas: [],
    };
    render(<TechnicianDetailPage technicianId="t1" />);
    const chip = screen.getByText("jt-lockout").closest("[data-status]") as HTMLElement;
    expect(chip).toHaveAttribute("data-status", "approved");
    expect(chip.className).toContain("rounded-chip");
    expect(chip.className).not.toMatch(/green/);
  });
});

describe("TechnicianDetailPage — guards", () => {
  it("refuses the page without technicians.view", () => {
    state.canViewTechs = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("locks the whole card for a viewer who may not edit technicians", async () => {
    state.canEditTechs = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("You can read this card but not change it.")).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toBeDisabled();
    expect(reason(screen.getByLabelText("City"))).toBe("You can read this technician's details but not change them.");
    expect(screen.getByLabelText("Labor cost per hour")).toBeDisabled();
  });

  it("lets a technician on their own card edit their details but not what a manager sets, and says why", () => {
    state.isTechnician = true;
    state.canEditUsers = false;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);

    expect(screen.getByLabelText("City")).toBeEnabled();
    expect(screen.getByLabelText("Labor cost per hour")).toBeDisabled();
    expect(reason(screen.getByLabelText("Labor cost per hour"))).toContain("A manager sets this.");
    expect(screen.getByRole("combobox", { name: "Status" })).toBeDisabled();
    expect(reason(screen.getByRole("combobox", { name: "User type" }))).toContain("A manager sets this.");
    expect(screen.getByRole("checkbox", { name: "Track location" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Mobile app installed" })).toBeDisabled();
    expect(reason(screen.getByLabelText("First name"))).toMatch(/live on the user record/);
    expect(reason(screen.getByLabelText("Email"))).toMatch(/live on the user record/);
  });

  it("sends a technician's own save without the operational fields the API would refuse", async () => {
    state.isTechnician = true;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);
    await save();
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    expect(Object.keys(fx.update.mock.calls[0][0].body).sort()).toEqual(["additionalPhones", "homeAddress", "phone"]);
  });

  it("sends the operational fields when a manager saves", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    await save();
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    const { body } = fx.update.mock.calls[0][0];
    expect(body.laborCostPerHour).toBe(45);
    expect(body.status).toBe("active");
    expect(body.technicianType).toBe("regular");
    expect(body.homeAddress).toMatchObject({ city: "Phoenix" });
  });
});

describe("TechnicianDetailPage — the card's own fields", () => {
  it("lets a manager put a photo on the card through the disc", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeEnabled();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe("image/png,image/jpeg,image/webp");
    const file = new File(["x"], "riley.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(fx.uploadPhoto).toHaveBeenCalledWith({ id: "t1", file });
  });

  it("offers no photo controls to a viewer who may not edit the card", () => {
    state.canEditTechs = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("button", { name: "Upload photo" })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("draws the numbers beside the one telephony rings, and saves the list", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("Additional phone 1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove additional phone 1" }));
    expect(screen.queryByLabelText("Additional phone 1")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Additional phone numbers" }));
    expect(screen.getByLabelText("Additional phone 1")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: "Remove additional phone 1" }));
    await save();
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    expect(fx.update.mock.calls[0][0].body.additionalPhones).toEqual([]);
  });

  it("saves the field-team switch to the user record, not the technician one", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const flag = screen.getByRole("checkbox", { name: "Field team member" });
    // Unset on the record: a technician is on the field team until switched off.
    expect(flag).toBeChecked();
    await userEvent.click(flag);
    await save();
    await waitFor(() => expect(fx.updateUser).toHaveBeenCalled());
    expect(fx.updateUser).toHaveBeenCalledWith({ id: "t1", body: { fieldTeamMember: false } });
    expect(fx.update.mock.calls[0][0].body.fieldTeamMember).toBeUndefined();
  });

  it("lets a manager change the name here, and sends only what changed to the user record", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const first = screen.getByLabelText("First name");
    expect(first).toBeEnabled();
    await userEvent.clear(first);
    await userEvent.type(first, "Riley-Ann");
    await save();
    await waitFor(() => expect(fx.updateUser).toHaveBeenCalled());
    expect(fx.updateUser).toHaveBeenCalledWith({ id: "t1", body: { firstName: "Riley-Ann" } });
  });

  it("leaves the user record alone when nothing on it changed", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    await save();
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    expect(fx.updateUser).not.toHaveBeenCalled();
  });

  it("keeps the email read-only and says why", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const email = screen.getByLabelText("Email");
    expect(email).toBeDisabled();
    expect(reason(email)).toMatch(/sign-in/);
  });

  it("locks the name and the field-team switch for a manager without users.edit", () => {
    state.canEditUsers = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("First name")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Field team member" })).toBeDisabled();
    expect(reason(screen.getByLabelText("First name"))).toMatch(/live on the user record/);
  });
});
