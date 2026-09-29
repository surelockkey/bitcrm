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

const hooks = vi.hoisted(() => ({
  pageCalls: [] as { params: Record<string, unknown>; enabled: boolean }[],
  searchCalls: [] as string[],
  hitIds: [] as string[],
}));

// The three bounded sources: this client's page off the contact index, a
// Job ID page, and a text search hydrated by id. Each answers from the
// same fixture, narrowed the way the server would narrow it.
vi.mock("@/features/deals/hooks", () => ({
  useDealsPage: (params: Record<string, unknown>, enabled = true) => {
    hooks.pageCalls.push({ params, enabled });
    const data = !enabled
      ? []
      : params.contactId
        ? deals.filter((d) => d.contactId === params.contactId)
        : params.search
          ? deals.filter((d) => d.dealNumber === params.search)
          : [];
    return { data: { pages: [{ data, pagination: { count: data.length } }] }, isLoading: false };
  },
  useDealsWindow: (_w: unknown, opts: { enabled?: boolean } = {}) => ({
    data: opts.enabled === false ? [] : deals,
    isLoading: false,
  }),
  useDealsByIds: (ids: string[], enabled = true) => ({
    data: enabled ? deals.filter((d) => ids.includes(d.id)) : [],
    isLoading: false,
  }),
}));
vi.mock("@/features/search/use-global-search", () => ({
  useGlobalSearch: (q: string) => {
    hooks.searchCalls.push(q);
    return { data: q ? { hits: hooks.hitIds.map((entityId) => ({ entityId })) } : undefined, isSearching: false };
  },
}));
vi.mock("@/features/clients/hooks", () => ({
  useContactsByIds: () => ({
    map: new Map([
      ["c1", { id: "c1", firstName: "Jane", lastName: "Roe" }],
      ["c2", { id: "c2", firstName: "Peter", lastName: "Novak" }],
    ]),
  }),
}));
vi.mock("@/features/deals/lib", () => ({ stageLabel: () => "Submitted" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
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
  beforeEach(() => {
    linkMutate.mockClear();
    hooks.pageCalls = [];
    hooks.searchCalls = [];
    hooks.hitIds = [];
  });

  it("opens on this client's jobs, latest first, without typing", () => {
    render(<LinkJobDialog call={call} onClose={vi.fn()} />);

    const rows = jobRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("#1042"); // newest of Jane's
    expect(rows[1]).toContain("#1001");
    // Somebody else's job is not in the untyped list, however recent it is.
    expect(screen.queryByText(/#2000/)).not.toBeInTheDocument();
  });

  it("reaches every job once a search is typed — a name goes to the search service", async () => {
    const u = userEvent.setup();
    hooks.hitIds = ["d-other"];
    render(<LinkJobDialog call={call} onClose={vi.fn()} />);
    await u.type(screen.getByRole("textbox"), "novak");
    expect(hooks.searchCalls).toContain("novak");
    const rows = jobRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("#2000");
  });

  it("a Job ID goes straight to the server, not to the search service", async () => {
    const u = userEvent.setup();
    render(<LinkJobDialog call={call} onClose={vi.fn()} />);
    await u.type(screen.getByRole("textbox"), "k4t9zw");
    const codeCall = hooks.pageCalls.find((c) => c.enabled && c.params.search === "K4T9ZW");
    expect(codeCall).toBeDefined();
    // The partial strings on the way were text; the finished code is not.
    expect(hooks.searchCalls).not.toContain("k4t9zw");
  });

  it("keeps this client's jobs above the rest of a broad search", async () => {
    const u = userEvent.setup();
    // The search answers all three, the stranger's first by relevance.
    hooks.hitIds = ["d-other", "d-new", "d-old"];
    render(<LinkJobDialog call={call} onClose={vi.fn()} />);
    await u.type(screen.getByRole("textbox"), "arizona");
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

  it("offers to open a job as well as link it, without leaving the call", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<LinkJobDialog call={call} onClose={onClose} />);

    const open = screen.getByRole("link", { name: /open job #1042/i });
    expect(open).toHaveAttribute("href", "/deals/d-new");

    // Reading the job is not the same as attaching the call to it.
    await u.click(open);
    expect(linkMutate).not.toHaveBeenCalled();
    // The dialog gets out of the way of the page being navigated to.
    expect(onClose).toHaveBeenCalled();
  });
});
