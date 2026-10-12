import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ClientType,
  DealPriority,
  DealStatus,
  JobSuperStatus,
  type Deal,
} from "@bitcrm/types";

import { JobList } from "./job-list";
import { ctToday, DEFAULT_TZ, zonedInstant } from "@/lib/timezone";

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
    assignedTechIds: ["t1"],
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

// Today (Connecticut's — the web's clock since 2026-10-12) at that clock time.
// The stamp a dispatcher reads is the time alone only while it happened today
// (`formatStamp`), so a fixture pinned to a calendar date stops matching the
// day after it was written.
const at = (h: number, m: number) =>
  zonedInstant(ctToday(), `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, DEFAULT_TZ).toISOString();

const renderList = (d: Deal) =>
  render(
    <JobList
      mapped={[d]}
      unmapped={[]}
      title={() => "Lockout - Job #1042"}
      hoveredId={null}
      onHover={vi.fn()}
      onSelect={vi.fn()}
    />,
  );

/**
 * The board's job is to make the gap visible: which jobs are still sitting
 * with the dispatcher, and which the technician has actually opened.
 */
describe("JobList — the Workiz job card", () => {
  it("reads type - Job #, the address with the state spelled out, and the status", () => {
    renderList(deal());
    const card = screen.getByTestId("job-row-d1");
    expect(card).toHaveTextContent("Lockout - Job #1042");
    expect(card).toHaveTextContent("1 Main, Phoenix, Arizona, 85001");
    expect(card).toHaveTextContent("Submitted");
  });
});

describe("JobList — Sent / Seen chips", () => {
  it("says nothing on a job that has not been sent", () => {
    renderList(deal());
    expect(screen.queryByText("Sent")).toBeNull();
    expect(screen.queryByText("Seen")).toBeNull();
  });

  it("marks a sent job, and says what it was sent by on hover", () => {
    renderList(deal({ sentToTechAt: at(12, 10), sentToTechVia: ["sms"] }));
    expect(screen.getByText("Sent").getAttribute("title")).toMatch(/^Sent · 12:10 PM E[DS]T via SMS$/);
    // Sent but not opened: the chip a dispatcher is looking for is absent.
    expect(screen.queryByText("Seen")).toBeNull();
  });

  it("adds the eye once the technician has opened it", () => {
    renderList(deal({ sentToTechAt: at(12, 10), sentToTechVia: ["sms"], seenByTechAt: at(12, 14) }));
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("Seen").getAttribute("title")).toMatch(/^Seen · 12:14 PM E[DS]T$/);
  });
});
