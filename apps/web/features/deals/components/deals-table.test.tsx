import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  JobSuperStatus,
  DealStatus,
} from "@bitcrm/types";
import type { Contact, Deal, User } from "@bitcrm/types";
import { DealsTable } from "./deals-table";

// Resolve job-type ids to names without a QueryClient/live catalog.
vi.mock("@/features/job-types/lib", () => ({
  useJobTypeName: () => (id: string | undefined) =>
    id === "jt-lockout" ? "Lockout" : (id ?? "—"),
}));

// JobTagChips reads the catalog via react-query; stub it so the row renders
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
    dealNumber: "1042",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "Phoenix",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    jobTypeId: "jt-lockout",
    superStatus: JobSuperStatus.SUBMITTED,
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
const userMap = new Map<string, User>();

describe("DealsTable", () => {
  it("opens the preview when a row is clicked", async () => {
    const onOpen = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={onOpen} />,
    );
    await userEvent.click(screen.getByText("Jane Smith"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });

  it("the job number itself is the new-tab link, sitting in the first column", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    const link = screen.getByRole("link", { name: /new tab/i });
    expect(link).toHaveAttribute("href", "/deals/d1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // The number is the click target — no reaching for the far edge of the row.
    expect(link).toHaveTextContent("#1042");
    const cell = link.closest("td");
    expect(cell).not.toBeNull();
    expect(cell!.cellIndex).toBe(0);
  });

  it("has no separate far-right new-tab column anymore", () => {
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={vi.fn()} />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(screen.queryByText("Open in new tab")).toBeNull();
  });

  it("does not open the preview when the new-tab link is clicked", async () => {
    const onOpen = vi.fn();
    render(
      <DealsTable deals={[deal()]} contactMap={contactMap} userMap={userMap} onOpen={onOpen} />,
    );
    // jsdom would navigate on a real anchor click; prevent that noise.
    const link = screen.getByRole("link", { name: /new tab/i });
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
