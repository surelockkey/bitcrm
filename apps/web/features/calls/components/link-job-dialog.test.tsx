import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallRecord } from "../lib";
import { LinkJobDialog } from "./link-job-dialog";

const linkMutate = vi.fn();

// Three jobs: two for the client on the call (one old, one new) and one for
// somebody else, which only a search should reach.
const deals = [
  {
    id: "d-old",
    dealNumber: "1001",
    contactId: "c1",
    stage: "submitted",
    address: { street: "1 Main", city: "Phoenix", state: "AZ", zip: "85001" },
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "d-new",
    dealNumber: "1042",
    contactId: "c1",
    stage: "submitted",
    address: { street: "9 Oak", city: "Phoenix", state: "AZ", zip: "85001" },
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "d-other",
    dealNumber: "2000",
    contactId: "c2",
    stage: "submitted",
    address: { street: "5 Elm", city: "Mesa", state: "AZ", zip: "85201" },
    createdAt: "2026-08-10T00:00:00.000Z",
  },
];

vi.mock("@/features/deals/hooks", () => ({
  useDeals: () => ({ data: deals, isLoading: false }),
  useContactMap: () => ({
    map: new Map([
      ["c1", { id: "c1", firstName: "Jane", lastName: "Roe" }],
      ["c2", { id: "c2", firstName: "Peter", lastName: "Novak" }],
    ]),
  }),
}));
vi.mock("@/features/deals/lib", () => ({ stageLabel: () => "Submitted" }));
vi.mock("../hooks", () => ({
  useLinkCallToDeal: () => ({ mutate: linkMutate, isPending: false }),
}));

const call: CallRecord = {
  callSid: "CA1",
  direction: "inbound",
  from: "+14045551234",
  to: "+15412830739",
  status: "completed",
  startedAt: "2026-08-14T10:00:00.000Z",
  updatedAt: "2026-08-14T10:00:00.000Z",
  fromParty: { kind: "contact", id: "c1", name: "Jane Roe" },
};

const jobRows = () =>
  screen
    .getAllByRole("button")
    .map((b) => b.textContent ?? "")
    .filter((t) => t.includes("#"));

describe("LinkJobDialog", () => {
  beforeEach(() => linkMutate.mockClear());

  it("opens on this client's jobs, latest first, without typing", () => {
    render(<LinkJobDialog call={call} onClose={vi.fn()} />);

    const rows = jobRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("#1042"); // newest of Jane's
    expect(rows[1]).toContain("#1001");
    // Somebody else's job is not in the untyped list, however recent it is.
    expect(screen.queryByText(/#2000/)).not.toBeInTheDocument();
  });

  it("reaches every job once a search is typed", async () => {
    const u = userEvent.setup();
    render(<LinkJobDialog call={call} onClose={vi.fn()} />);

    await u.type(screen.getByRole("textbox"), "novak");

    const rows = jobRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("#2000");
  });

  it("keeps this client's jobs above the rest of a broad search", async () => {
    const u = userEvent.setup();
    render(<LinkJobDialog call={call} onClose={vi.fn()} />);

    // Matches all three by city/state — d-other is the most recent overall.
    await u.type(screen.getByRole("textbox"), "az");

    const rows = jobRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("#1042");
    expect(rows[2]).toContain("#2000");
  });

  it("says so when the client has no jobs yet, rather than listing strangers'", () => {
    const stranger: CallRecord = {
      ...call,
      fromParty: { kind: "contact", id: "c9", name: "New Caller" },
    };
    render(<LinkJobDialog call={stranger} onClose={vi.fn()} />);

    expect(screen.getByText(/no jobs for this client yet/i)).toBeInTheDocument();
    expect(jobRows()).toHaveLength(0);
  });

  it("links the call to whichever job is picked", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<LinkJobDialog call={call} onClose={onClose} />);

    await u.click(screen.getByRole("button", { name: /#1042/ }));

    expect(linkMutate).toHaveBeenCalledWith(
      { sid: "CA1", dealId: "d-new" },
      expect.anything(),
    );
  });
});
