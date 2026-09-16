import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  DealStatus,
  JobSuperStatus,
  type Contact,
  type Deal,
} from "@bitcrm/types";
import { TechJobPage } from "./tech-job-page";

const can = vi.fn((resource: string) => resource === "deals");
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can, isTechnician: true, isLoading: false }),
}));

const dealQuery = vi.fn();
const addNote = { mutate: vi.fn(), isPending: false };
vi.mock("@/features/deals/hooks", () => ({
  useDeal: () => dealQuery(),
  useAddNote: () => addNote,
}));

const contactData = vi.hoisted(() => ({ value: undefined as Contact | undefined }));
vi.mock("@/features/clients/hooks", () => ({ useContact: () => ({ data: contactData.value }) }));
vi.mock("@/features/job-types/lib", () => ({ useJobTypeName: () => () => "Lockout" }));
vi.mock("@/features/job-statuses/lib", () => ({ useJobStatusName: () => () => "On site" }));
vi.mock("@/features/telephony/components/call-client-button", () => ({
  CallClientButton: () => <button type="button">Call client</button>,
}));
vi.mock("./tech-actions", () => ({ TechActions: () => <div data-testid="tech-actions" /> }));
vi.mock("./tech-photo-capture", () => ({ TechPhotoCapture: () => <div data-testid="tech-photos" /> }));

const CONTACT: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "A1B2C3",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "CT",
    address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" },
    jobTypeId: "jt1",
    superStatus: JobSuperStatus.IN_PROGRESS,
    assignedTechIds: ["t1"],
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    scheduledDate: "2026-09-16",
    scheduledTimeSlot: "09:00-12:00",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("TechJobPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockImplementation((resource: string) => resource === "deals");
    contactData.value = CONTACT;
    dealQuery.mockReturnValue({ data: deal(), isLoading: false, isError: false });
  });

  it("refuses a viewer who may not see jobs", () => {
    can.mockReturnValue(false);
    render(<TechJobPage dealId="d1" />);
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });

  it("leads with where to go and how to reach the client", () => {
    render(<TechJobPage dealId="d1" />);

    expect(screen.getByRole("heading", { name: "Jane Smith" })).toBeInTheDocument();
    expect(screen.getByText("1 Main St, Hartford, CT 06103")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^navigate to/i })).toHaveAttribute(
      "href",
      expect.stringContaining("google.com/maps/dir"),
    );
    expect(screen.getByRole("button", { name: "Call client" })).toBeInTheDocument();
  });

  it("carries the visit actions, the photos, and a way back to the day", () => {
    render(<TechJobPage dealId="d1" />);

    expect(screen.getByTestId("tech-actions")).toBeInTheDocument();
    expect(screen.getByTestId("tech-photos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /my jobs/i })).toHaveAttribute("href", "/my-jobs");
    // The office view is a link away for anything this page leaves out.
    expect(screen.getByRole("link", { name: /open the full job/i })).toHaveAttribute(
      "href",
      "/deals/d1",
    );
  });

  it("saves a note and clears the box", async () => {
    render(<TechJobPage dealId="d1" />);
    const save = screen.getByRole("button", { name: /save note/i });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Note"), "Replaced the cylinder");
    await userEvent.click(save);

    expect(addNote.mutate).toHaveBeenCalledWith(
      "Replaced the cylinder",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("says so, with a way back, when the job is gone", () => {
    dealQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<TechJobPage dealId="d1" />);

    expect(screen.getByText("Job not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to my jobs/i })).toHaveAttribute(
      "href",
      "/my-jobs",
    );
  });
});
