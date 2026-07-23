import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  DealStage,
  DealStatus,
  UserStatus,
} from "@bitcrm/types";
import type { Contact, Deal, User } from "@bitcrm/types";
import { DealCard } from "./deal-card";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The card resolves job-type ids to names via the catalog hook; stub it so the
// test doesn't need a QueryClient or a live catalog.
vi.mock("@/features/job-types/lib", () => ({
  useJobTypeName: () => (id: string | undefined) =>
    id === "jt-lockout" ? "Lockout" : (id ?? "—"),
}));

// JobTagChips reads the catalog via react-query; stub it so the card renders
// without a QueryClient (the test deal carries no tags anyway).
vi.mock("@/features/job-tags/components/job-tag-chips", () => ({
  JobTagChips: () => null,
}));

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const tech: User = {
  id: "t1",
  firstName: "Riley",
  lastName: "Santos",
  email: "riley@slk.com",
  roleId: "role-technician",
  department: "Field",
  status: UserStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
} as User;

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: 1042,
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-lockout",
    stage: DealStage.NEW_LEAD,
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    assignedTechIds: [],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const contactMap = new Map([[contact.id, contact]]);
const userMap = new Map([[tech.id, tech]]);

describe("DealCard", () => {
  it("shows the deal number, client name, and area · job type", () => {
    render(<DealCard deal={deal()} contactMap={contactMap} userMap={userMap} />);
    expect(screen.getByText("#1042")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText(/Phoenix · Lockout/)).toBeInTheDocument();
  });

  it("flags urgent deals and shows the assigned tech", () => {
    render(<DealCard deal={deal({ priority: DealPriority.URGENT, assignedTechIds: ["t1"] })} contactMap={contactMap} userMap={userMap} />);
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("Riley Santos")).toBeInTheDocument();
  });

  it("navigates to the deal on click", async () => {
    render(<DealCard deal={deal()} contactMap={contactMap} userMap={userMap} />);
    await userEvent.click(screen.getByText("Jane Smith"));
    expect(push).toHaveBeenCalledWith("/deals/d1");
  });
});
