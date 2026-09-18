import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AVAILABILITY_NOT_CONNECTED,
  SETTINGS_NOT_CONNECTED,
  allNotConnected,
} from "../not-connected";
import { TechnicianDetailPage } from "./technician-detail-page";

/**
 * The card is assembled from live controls and dead ones. What is asserted here
 * is the join between them: the order a Workiz user reads the page in, that
 * every dead control really is dead, and that the two halves of the API's edit
 * rule are drawn where the API draws them.
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
  meId: "mgr-1",
}));

const fx = vi.hoisted(() => ({
  update: vi.fn(),
  updateUser: vi.fn(),
  uploadPhoto: vi.fn(),
  deletePhoto: vi.fn(),
  rolesEnabled: [] as boolean[],
  assignments: { jobTypes: [] as unknown[], serviceAreas: [] as unknown[] },
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

vi.mock("@/features/auth/use-permissions", () => ({
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
        { id: "t1", firstName: "Riley", lastName: "Santos", email: "riley@slk", roleId: "role-technician" },
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

// The name and the field-team flag live on the user record and save through
// the users feature; only that the card reaches for it matters here.
vi.mock("@/features/users/hooks", () => ({
  useUpdateUser: () => ({ mutate: fx.updateUser, isPending: false }),
}));

vi.mock("../masking-hooks", () => ({
  useSetClientNumberVisibility: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Honours `enabled` the way the real hook does, so a test can tell the
// difference between "asked and got it" and "never asked".
vi.mock("@/features/roles/hooks", () => ({
  useRoles: (enabled = true) => {
    fx.rolesEnabled.push(enabled);
    return { data: enabled ? [{ id: "role-technician", name: "Technician", priority: 20 }] : undefined };
  },
}));

vi.mock("@/features/service-areas/hooks", () => ({ useServiceAreas: () => ({ data: [] }) }));
vi.mock("@/features/job-types/lib", () => ({ useJobTypeName: () => (id: string) => id }));

// Heavy neighbours, each with its own tests: only their presence matters here.
vi.mock("@/features/messaging/components/text-button", () => ({
  TextButton: () => <button type="button">Text</button>,
}));
vi.mock("@/features/schedule/components/working-hours-editor", () => ({
  WorkingHoursEditor: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="working-hours" data-readonly={readOnly ? "yes" : "no"} />
  ),
}));
// Forwards what the card gives it and invents nothing: a mock that hardcoded
// `aria-label` would prove the mock has a name, not the field.
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({
    value,
    id,
    ariaLabel,
    placeholder,
  }: {
    value: string;
    id?: string;
    ariaLabel?: string;
    placeholder?: string;
  }) => <input id={id} aria-label={ariaLabel} placeholder={placeholder} defaultValue={value} />,
}));
vi.mock("./commission-tab", () => ({
  CommissionTab: () => <div data-testid="commission-panel" />,
}));
vi.mock("./documents-tab", () => ({
  DocumentsTab: () => <div data-testid="documents-panel" />,
}));

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
  state.meId = "mgr-1";
  fx.update.mockReset();
  fx.updateUser.mockReset();
  fx.uploadPhoto.mockReset();
  fx.deletePhoto.mockReset();
  fx.rolesEnabled.length = 0;
  fx.assignments = { jobTypes: [], serviceAreas: [] };
});

/** Index of a piece of text inside an element, for order assertions. */
const at = (el: HTMLElement, text: string) => {
  const i = (el.textContent ?? "").indexOf(text);
  expect(i, `"${text}" is missing`).toBeGreaterThan(-1);
  return i;
};

describe("TechnicianDetailPage — one page, two columns", () => {
  it("keeps the tabs this card has always had, opening on the form", () => {
    // Assignments moved onto the form on 2026-09-17, under the labor cost,
    // where Workiz has job types and areas — so one tab fewer.
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Profile",
      "Overview",
      "Commission",
      "Documents",
    ]);
    expect(screen.getByRole("tab", { name: "Profile" })).toHaveAttribute("aria-selected", "true");
  });

  it("pins the Save bar under the middle of both columns", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const bar = screen.getByRole("button", { name: /save changes/i }).parentElement!;
    // The job card's own footer: centred, bordered, and outside the scroll
    // region so it cannot scroll away while somebody edits.
    expect(bar.className).toContain("justify-center");
    expect(bar.className).toContain("border-t");
  });

  it("draws the person column in Workiz's order", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const col = screen.getByTestId("person-column");
    // Track location sits under the photo, where the owner asked for it.
    const order = [
      "Profile picture",
      "Track location",
      "User type",
      "First name",
      "Email",
      "Phone",
      "Additional phone numbers",
      "Home address",
    ].map((label) => at(col, label));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("draws the work column in Workiz's order, with ours at the foot", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const col = screen.getByTestId("work-column");
    const order = [
      "Field team member",
      "Labor cost per hour",
      "Job types — what they can do",
      "Service areas — where they work",
      "Schedule color",
      "Hide client numbers",
      "Two-factor authentication",
      "Notes",
      "Not on the Workiz card — ours",
      "Status",
    ].map((label) => at(col, label));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("carries no Role field, and never asks for the roles list", () => {
    // The role is set on the user record, with its confirmation and its reset
    // of overrides; the owner struck the read-only copy from this card.
    render(<TechnicianDetailPage technicianId="t1" />);
    const col = screen.getByTestId("work-column");
    expect(within(col).queryByText("Role")).toBeNull();
    expect(screen.queryByRole("link", { name: /customize roles and permissions here/i })).toBeNull();
    expect(fx.rolesEnabled).toEqual([]);
  });

  it("carries the live values we hold into the form", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("Labor cost per hour")).toHaveValue(45);
    expect(screen.getByLabelText("City")).toHaveValue("Phoenix");
    expect(screen.getByRole("switch", { name: "Track location" })).toBeChecked();
  });

  it("names the street field itself, editable or not — the group label names the block", () => {
    const { unmount } = render(<TechnicianDetailPage technicianId="t1" />);
    // Editable: the autocomplete. A placeholder is not a name.
    expect(screen.getByLabelText("Street address")).toHaveValue("12 Oak St");
    unmount();

    state.canEditTechs = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("Street address")).toBeDisabled();
  });
});

/** Radix renders only the open tab, so a check has to go where its field lives. */
const openTab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));

/** Availability and the Workiz-settings block live on Overview; every other dead field on Profile. */
const OVERVIEW_KEYS = new Set([AVAILABILITY_NOT_CONNECTED.key, ...SETTINGS_NOT_CONNECTED.map((f) => f.key)]);
const tabOf = (key: string) => (OVERVIEW_KEYS.has(key) ? "Overview" : "Profile");

describe("TechnicianDetailPage — what is drawn but dead", () => {
  it("disables every not-connected control and says why beside it", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    for (const field of allNotConnected()) {
      await openTab(tabOf(field.key));
      const block = screen.getByTestId(`not-connected-${field.key}`);
      expect(block).toHaveTextContent(field.label);
      expect(block).toHaveTextContent(field.note);
      for (const control of block.querySelectorAll("input, textarea, button, select")) {
        expect(control).toBeDisabled();
      }
    }
  });

  it("gives no dead control a value to be misread", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    for (const field of allNotConnected()) {
      await openTab(tabOf(field.key));
      const block = screen.getByTestId(`not-connected-${field.key}`);
      // Radix's switch keeps a hidden checkbox for form submission; its "on" is
      // the checkbox default, not a value of ours — `checked` below is what
      // says whether the switch reads as set.
      for (const control of block.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="checkbox"]):not([type="hidden"]), textarea',
      )) {
        expect(control.value).toBe("");
      }
      for (const control of block.querySelectorAll('[role="switch"]')) {
        expect(control).not.toBeChecked();
      }
    }
  });

  it("ties the live controls that are disabled to their reason too", () => {
    state.isTechnician = true;
    state.canEditUsers = false;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);

    // Why it is greyed has to reach whoever can't see that it is greyed.
    const reason = (el: HTMLElement) =>
      document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent;
    expect(reason(screen.getByLabelText("Labor cost per hour"))).toBe("A manager sets this.");
    expect(reason(screen.getByLabelText("Status"))).toBe("A manager sets this.");
    // Read-only by role, not by permission: the name and email are the user
    // record's, and the one line that says so answers for all three.
    expect(reason(screen.getByLabelText("First name"))).toMatch(/live on the user record/);
    expect(reason(screen.getByLabelText("Email"))).toMatch(/live on the user record/);
  });

  it("gives the locked-out viewer's address fields the reason they are locked", () => {
    state.canEditTechs = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    const city = screen.getByLabelText("City");
    expect(city).toBeDisabled();
    expect(
      document.getElementById(city.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("You can read this technician's details but not change them.");
  });

  it("ties each dead control to its own explanation for a screen reader", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const block = screen.getByTestId("not-connected-two-factor");
    const control = block.querySelector('[role="switch"]');
    const describedBy = control?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toContain("Cognito");
  });
});

describe("TechnicianDetailPage — the blocks below the columns", () => {
  it("keeps availability, onboarding, commission and documents, each on its tab", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    // Radix renders only the open tab, so each is asserted where it lives.
    await openTab("Overview");
    expect(screen.getByTestId("working-hours")).toHaveAttribute("data-readonly", "no");
    expect(screen.getByText("Onboarding")).toBeInTheDocument();
    await openTab("Commission");
    expect(screen.getByTestId("commission-panel")).toBeInTheDocument();
    await openTab("Documents");
    expect(screen.getByTestId("documents-panel")).toBeInTheDocument();
  });

  it("hides the commission and documents blocks without their permissions", () => {
    state.canViewCommission = false;
    state.canViewDocuments = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("tab", { name: "Commission" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Documents" })).toBeNull();
  });

  it("hides the job-type and service-area assignments without their view permissions", () => {
    state.canViewJobTypes = false;
    state.canViewServiceAreas = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByText(/Job types — what they can do/)).toBeNull();
    expect(screen.queryByText(/Service areas — where they work/)).toBeNull();
  });

  it("draws an approved assignment plain on the card — the owner struck the green", () => {
    fx.assignments = {
      jobTypes: [{ jobTypeId: "jt-lockout", status: "approved", proposedBy: "m", proposedAt: "t" }],
      serviceAreas: [],
    };
    render(<TechnicianDetailPage technicianId="t1" />);
    const chip = screen.getByText("jt-lockout").closest("span.rounded-full") as HTMLElement;
    expect(chip).not.toBeNull();
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
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(screen.getByLabelText("City")).toBeDisabled();
    expect(screen.getByLabelText("Labor cost per hour")).toBeDisabled();
    await openTab("Overview");
    expect(screen.getByTestId("working-hours")).toHaveAttribute("data-readonly", "yes");
  });

  it("lets a technician on their own card edit their details but not their labor cost", async () => {
    state.isTechnician = true;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);

    expect(screen.getByLabelText("City")).toBeEnabled();
    expect(screen.getByLabelText("Labor cost per hour")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Track location" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Mobile app installed" })).toBeDisabled();
    expect(screen.getAllByText("A manager sets this.").length).toBeGreaterThan(0);
    await openTab("Overview");
    expect(screen.getByTestId("working-hours")).toHaveAttribute("data-readonly", "yes");
  });

  it("sends a technician's own save without the operational fields the API would refuse", async () => {
    state.isTechnician = true;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fx.update).toHaveBeenCalled());

    const { body } = fx.update.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(["additionalPhones", "homeAddress", "phone"]);
  });

  it("sends the operational fields when a manager saves", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fx.update).toHaveBeenCalled());

    const { body } = fx.update.mock.calls[0][0];
    expect(body.laborCostPerHour).toBe(45);
    expect(body.status).toBe("active");
    expect(body.technicianType).toBe("regular");
    expect(body.homeAddress).toMatchObject({ city: "Phoenix" });
  });
});

/**
 * The fields the owner asked for on 2026-09-17, each live where Workiz has it:
 * no way back in the header, the photo on the card, a real user type, real
 * additional numbers, and the two that belong to the user record — the name
 * and the field-team switch — saved there.
 */
describe("TechnicianDetailPage — the card's own fields", () => {
  it("has no way back in the header — the sidebar is the way back", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("button", { name: /technicians/i })).toBeNull();
  });

  it("shows the user type, and keeps it with the manager", () => {
    const { unmount } = render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("User type")).toHaveTextContent("Regular");
    expect(screen.getByLabelText("User type")).toBeEnabled();
    unmount();

    state.isTechnician = true;
    state.canEditUsers = false;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);
    const select = screen.getByLabelText("User type");
    expect(select).toBeDisabled();
    expect(document.getElementById(select.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "A manager sets this.",
    );
  });

  it("lets a manager put a photo on the card, and says nothing about documents", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByText(/uploaded with their documents/i)).toBeNull();
    expect(screen.getByRole("button", { name: /upload photo/i })).toBeEnabled();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe("image/png,image/jpeg,image/webp");
    const file = new File(["x"], "riley.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(fx.uploadPhoto).toHaveBeenCalledWith({ id: "t1", file });
  });

  it("offers no photo controls to a viewer who may not edit the card", () => {
    state.canEditTechs = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("button", { name: /upload photo/i })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("draws the numbers beside the one telephony rings, and saves the list", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("Additional phone 1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove additional phone 1" }));
    expect(screen.queryByLabelText("Additional phone 1")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /add number/i }));
    expect(screen.getByLabelText("Additional phone 1")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: "Remove additional phone 1" }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    expect(fx.update.mock.calls[0][0].body.additionalPhones).toEqual([]);
  });

  it("saves the field-team switch to the user record, not the technician one", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const flag = screen.getByRole("switch", { name: "Field team member" });
    // Unset on the record: a technician is on the field team until switched off.
    expect(flag).toBeChecked();

    await userEvent.click(flag);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

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
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fx.updateUser).toHaveBeenCalled());
    expect(fx.updateUser).toHaveBeenCalledWith({ id: "t1", body: { firstName: "Riley-Ann" } });
  });

  it("leaves the user record alone when nothing on it changed", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fx.update).toHaveBeenCalled());
    expect(fx.updateUser).not.toHaveBeenCalled();
  });

  it("keeps the email read-only and says why", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const email = screen.getByLabelText("Email");
    expect(email).toBeDisabled();
    expect(document.getElementById(email.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(
      /sign-in/,
    );
  });

  it("locks the name and the switch for a manager without users.edit, and says where they live", () => {
    state.canEditUsers = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("First name")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Field team member" })).toBeDisabled();
    const reason = document.getElementById(
      screen.getByLabelText("First name").getAttribute("aria-describedby") ?? "",
    )?.textContent;
    expect(reason).toMatch(/live on the user record/);
  });
});
