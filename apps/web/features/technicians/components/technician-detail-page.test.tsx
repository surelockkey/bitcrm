import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { allNotConnected } from "../not-connected";
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
  meId: "mgr-1",
}));

const fx = vi.hoisted(() => ({
  update: vi.fn(),
  profile: {
    userId: "t1",
    phone: "+14045551234",
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
        case "roles":
          return true;
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
  useAssignments: () => ({ data: { jobTypes: [], serviceAreas: [] }, isLoading: false }),
  useUpdateProfile: () => ({ mutate: fx.update, isPending: false }),
  useApproveAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeAssignment: () => ({ mutate: vi.fn(), isPending: false }),
  useProposeAssignments: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignDirect: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../masking-hooks", () => ({
  useSetClientNumberVisibility: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/roles/hooks", () => ({
  useRoles: () => ({ data: [{ id: "role-technician", name: "Technician", priority: 20 }] }),
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
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value }: { value: string }) => (
    <input aria-label="Street address" defaultValue={value} />
  ),
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
  state.meId = "mgr-1";
  fx.update.mockReset();
});

/** Index of a piece of text inside an element, for order assertions. */
const at = (el: HTMLElement, text: string) => {
  const i = (el.textContent ?? "").indexOf(text);
  expect(i, `"${text}" is missing`).toBeGreaterThan(-1);
  return i;
};

describe("TechnicianDetailPage — one page, two columns", () => {
  it("has no tabs left: the form is the page", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("draws the person column in Workiz's order", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const col = screen.getByTestId("person-column");
    const order = [
      "Profile picture",
      "User type",
      "First name",
      "Email",
      "Phone",
      "Additional phone numbers",
      "Home address",
      "Track location",
    ].map((label) => at(col, label));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("draws the work column in Workiz's order, with ours at the foot", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const col = screen.getByTestId("work-column");
    const order = [
      "Role",
      "Field team member",
      "Labor cost per hour",
      "Job types",
      "User skills",
      "Service areas",
      "Schedule color",
      "Hide client numbers",
      "Two-factor authentication",
      "Notes",
      "Not on the Workiz card — ours",
      "Status",
    ].map((label) => at(col, label));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("keeps the role read-only, with the link to where roles are changed", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    const col = screen.getByTestId("work-column");
    expect(within(col).getByText("Technician")).toBeInTheDocument();
    expect(
      within(col).getByRole("link", { name: /customize roles and permissions here/i }),
    ).toHaveAttribute("href", "/admin/roles");
  });

  it("carries the live values we hold into the form", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByLabelText("Labor cost per hour")).toHaveValue(45);
    expect(screen.getByLabelText("City")).toHaveValue("Phoenix");
    expect(screen.getByRole("switch", { name: "Track location" })).toBeChecked();
  });
});

describe("TechnicianDetailPage — what is drawn but dead", () => {
  it("disables every not-connected control and says why beside it", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    for (const field of allNotConnected()) {
      const block = screen.getByTestId(`not-connected-${field.key}`);
      expect(block).toHaveTextContent(field.label);
      expect(block).toHaveTextContent(field.note);
      for (const control of block.querySelectorAll("input, textarea, button, select")) {
        expect(control).toBeDisabled();
      }
    }
  });

  it("gives no dead control a value to be misread", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    for (const field of allNotConnected()) {
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
  it("keeps availability, onboarding, commission and documents on the page", () => {
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByTestId("working-hours")).toHaveAttribute("data-readonly", "no");
    expect(screen.getByText("Onboarding")).toBeInTheDocument();
    expect(screen.getByTestId("commission-panel")).toBeInTheDocument();
    expect(screen.getByTestId("documents-panel")).toBeInTheDocument();
  });

  it("hides the commission and documents blocks without their permissions", () => {
    state.canViewCommission = false;
    state.canViewDocuments = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByTestId("commission-panel")).toBeNull();
    expect(screen.queryByTestId("documents-panel")).toBeNull();
  });

  it("hides the job-type and service-area assignments without their view permissions", () => {
    state.canViewJobTypes = false;
    state.canViewServiceAreas = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByText(/Job types — what they can do/)).toBeNull();
    expect(screen.queryByText(/Service areas — where they work/)).toBeNull();
  });
});

describe("TechnicianDetailPage — guards", () => {
  it("refuses the page without technicians.view", () => {
    state.canViewTechs = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("locks the whole card for a viewer who may not edit technicians", () => {
    state.canEditTechs = false;
    render(<TechnicianDetailPage technicianId="t1" />);
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(screen.getByLabelText("City")).toBeDisabled();
    expect(screen.getByLabelText("Labor cost per hour")).toBeDisabled();
    expect(screen.getByTestId("working-hours")).toHaveAttribute("data-readonly", "yes");
  });

  it("lets a technician on their own card edit their details but not their labor cost", () => {
    state.isTechnician = true;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);

    expect(screen.getByLabelText("City")).toBeEnabled();
    expect(screen.getByLabelText("Labor cost per hour")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Track location" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Mobile app installed" })).toBeDisabled();
    expect(screen.getByTestId("working-hours")).toHaveAttribute("data-readonly", "yes");
    expect(screen.getAllByText("A manager sets this.").length).toBeGreaterThan(0);
  });

  it("sends a technician's own save without the operational fields the API would refuse", async () => {
    state.isTechnician = true;
    state.meId = "t1";
    render(<TechnicianDetailPage technicianId="t1" />);

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fx.update).toHaveBeenCalled());

    const { body } = fx.update.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(["homeAddress", "phone"]);
  });

  it("sends the operational fields when a manager saves", async () => {
    render(<TechnicianDetailPage technicianId="t1" />);

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fx.update).toHaveBeenCalled());

    const { body } = fx.update.mock.calls[0][0];
    expect(body.laborCostPerHour).toBe(45);
    expect(body.status).toBe("active");
    expect(body.homeAddress).toMatchObject({ city: "Phoenix" });
  });
});
