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
import { TechJobCard } from "./tech-job-card";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const contactData = vi.hoisted(() => ({ value: undefined as Contact | undefined }));
vi.mock("@/features/clients/hooks", () => ({ useContact: () => ({ data: contactData.value }) }));
vi.mock("@/features/job-types/lib", () => ({
  useJobTypeName: () => (id: string | undefined) => (id === "jt1" ? "Lockout" : "—"),
}));
vi.mock("@/features/job-statuses/lib", () => ({
  useJobStatusName: () => (id: string | undefined) => (id === "s1" ? "On site" : "—"),
}));
vi.mock("@/features/telephony/components/call-client-button", () => ({
  CallClientButton: () => <button type="button">Call client</button>,
}));

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

describe("TechJobCard", () => {
  beforeEach(() => {
    push.mockClear();
    contactData.value = CONTACT;
  });

  it("leads with the time, the client and where to go", () => {
    render(<TechJobCard deal={deal()} position={2} />);

    expect(screen.getByText("9:00 AM – 12:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("1 Main St, Hartford, CT 06103")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop 2")).toBeInTheDocument();
  });

  it("navigates by coordinates when the job is geocoded", () => {
    render(
      <TechJobCard
        deal={deal({ address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103", lat: 41.76, lng: -72.67 } })}
      />,
    );

    expect(screen.getByRole("link", { name: /^navigate to/i })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=41.76%2C-72.67",
    );
  });

  it("opens the technician's own job page on a tap, not the office one", async () => {
    render(<TechJobCard deal={deal()} />);
    await userEvent.click(screen.getByText("Jane Smith"));

    expect(push).toHaveBeenCalledWith("/my-jobs/d1");
  });

  it("does not open the job when the action row is used", async () => {
    render(<TechJobCard deal={deal()} />);
    await userEvent.click(screen.getByRole("button", { name: "Call client" }));

    expect(push).not.toHaveBeenCalled();
  });

  it("still offers the call when the number is masked, without showing digits", () => {
    contactData.value = { ...CONTACT, phones: [], phonesMasked: true } as Contact;
    render(<TechJobCard deal={deal()} />);

    expect(screen.getByRole("button", { name: "Call client" })).toBeInTheDocument();
    expect(screen.queryByText(/404/)).not.toBeInTheDocument();
  });

  it("shows the confirm and arrival stamps once they exist", () => {
    render(
      <TechJobCard
        deal={deal({ techConfirmedAt: "2026-09-16T13:00:00Z", arrivedAt: "2026-09-16T13:30:00Z" })}
      />,
    );

    expect(screen.getByText(/^Confirmed /)).toBeInTheDocument();
    expect(screen.getByText(/^Arrived /)).toBeInTheDocument();
  });
});
