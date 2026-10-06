import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortalInboxPage, PortalView as PortalViewData } from "@bitcrm/types";
import { InvalidPortalLink, PortalLoadError, PortalView } from "./portal-view";
import type { DocumentLoaders } from "./document-viewer";

vi.mock("./navigate", () => ({ goTo: vi.fn() }));

const loaders: DocumentLoaders = {
  getHtml: vi.fn(async () => ({ html: "<html><head></head><body>doc</body></html>" })),
  getPdfUrl: vi.fn(async () => ({ url: "https://s3/doc.pdf" })),
};

const view: PortalViewData = {
  business: {
    name: "Acme Locks",
    phone: "+1 (404) 555-0100",
    email: "hi@acme.test",
    description: "Locksmith, door and garage door services",
    bookingUrl: "https://book.acme.test",
    logoUrl: "https://files.test/logo.png",
  },
  client: { firstName: "Jane", lastName: "Smith", email: "jane@client.test", phone: "+14045550123" },
  estimates: [
    {
      kind: "estimate", id: "e1", number: "1042-1", name: "Storefront door", date: "2026-09-30", status: "pending", total: 3886.84,
      sent: true, signatureNeeded: true, signed: false, depositDue: 1943.42, payable: true,
    },
    { kind: "estimate", id: "e2", number: "1042-2", name: "9 Lite", date: "2026-09-30", status: "pending", total: 2000.03, sent: true, proposalId: "p1", signatureNeeded: true },
    { kind: "estimate", id: "e3", number: "1042-3", name: "16 Lite", date: "2026-09-30", status: "pending", total: 2117.62, sent: true, proposalId: "p1", signatureNeeded: true },
  ],
  invoices: [
    {
      kind: "invoice", id: "d1", number: "1042", date: "2026-09-29", status: "paid", total: 50.46,
      balanceDue: 0, dueDate: "2026-10-02", sent: true, signed: true,
    },
    {
      kind: "invoice", id: "d2", number: "1043", date: "2026-09-28", status: "due", total: 300,
      balanceDue: 120.5, dueDate: "2026-10-12", sent: true, payable: true, signatureNeeded: true,
    },
  ],
  proposals: [
    {
      id: "p1", number: "256", status: "pending", sentAt: "2026-09-30T11:01:03.000Z", estimateIds: ["e2", "e3"],
      options: [],
    },
  ],
  jobs: [
    { id: "j1", number: "J1", kind: "upcoming", scheduledDate: "2026-10-05T14:00:00.000Z", scheduledEndDate: "2026-10-05T16:00:00.000Z", timezone: "America/New_York", jobType: "Lock change", address: "1 Main St, Hartford, CT 06103", technicians: ["Mike Smith"] },
    { id: "j2", number: "J2", kind: "completed", scheduledDate: "2026-09-01T14:00:00.000Z", jobType: "Rekey", technicians: [] },
  ],
  payments: [
    { id: "p1", amount: 50.46, method: "card", status: "settled", takenAt: "2026-09-29T13:52:00.000Z", invoiceId: "d1", cardBrand: "visa", last4: "4061" },
  ],
  preview: false,
};
// The proposal's options are the same summaries the inbox lists.
view.proposals[0].options = [view.estimates[1], view.estimates[2]];

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("PortalView — the Workiz layout", () => {
  it("heads the page with the company, its tagline, phone and Book a service; greets the client by first name", () => {
    render(<PortalView view={view} loaders={loaders} />);
    expect(screen.getByText("Acme Locks")).toBeInTheDocument();
    expect(screen.getByText("Locksmith, door and garage door services")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\(404\) 555-0100/ })).toHaveAttribute("href", "tel:+14045550100");
    expect(screen.getByRole("link", { name: /book a service/i })).toHaveAttribute("href", "https://book.acme.test");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hey Jane, it's great to see you.");
    expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "My Booking" })).toBeInTheDocument();
  });

  it("lists the inbox as Workiz cards: estimate / proposal / invoice with chips, Sent | Due, Deposit and Total", () => {
    render(<PortalView view={view} loaders={loaders} />);
    const inbox = screen.getByRole("region", { name: "Your inbox" });
    expect(within(inbox).getByRole("heading", { name: "Your Inbox (4)" })).toBeInTheDocument();
    const est = within(inbox).getByRole("button", { name: "Estimate #1042-1 Storefront door" });
    expect(est).toHaveTextContent("AWAITING APPROVAL");
    expect(est).toHaveTextContent("Sent Sep 30, 2026");
    expect(est).toHaveTextContent("Deposit: $1,943.42");
    expect(est).toHaveTextContent("Total: $3,886.84");
    // Options of a proposal are not listed on their own.
    expect(within(inbox).queryByRole("button", { name: /1042-2/ })).toBeNull();
    const proposal = within(inbox).getByRole("button", { name: "Proposal #256" });
    expect(proposal).toHaveTextContent("PENDING");
    expect(proposal).toHaveTextContent("2 estimates");
    const paid = within(inbox).getByRole("button", { name: "Invoice #1042" });
    expect(paid).toHaveTextContent("PAID");
    expect(paid).toHaveTextContent("Sent Sep 29, 2026 | Due Oct 2, 2026");
    expect(within(inbox).getByRole("button", { name: "Invoice #1043" })).toHaveTextContent("PENDING");
  });

  it("opens an estimate on the right: Required deposit, Decline and Approve & pay deposit, the document as a page", async () => {
    const actions = { onApprove: vi.fn(), onDecline: vi.fn() };
    render(<PortalView view={view} loaders={loaders} actions={actions} />);
    await user().click(screen.getByRole("button", { name: "Estimate #1042-1 Storefront door" }));
    const pane = screen.getByRole("region", { name: "Document" });
    expect(within(pane).getByRole("heading", { name: /estimate #1042-1/i })).toBeInTheDocument();
    expect(within(pane).getByText("Required deposit: $1,943.42")).toBeInTheDocument();
    await user().click(within(pane).getByRole("button", { name: /approve & pay deposit/i }));
    expect(actions.onApprove).toHaveBeenCalledWith(view.estimates[0]);
    await user().click(within(pane).getByRole("button", { name: /^decline$/i }));
    expect(actions.onDecline).toHaveBeenCalledWith(view.estimates[0]);
    expect(await within(pane).findByTitle("Estimate #1042-1")).toBeInTheDocument();
    expect(loaders.getHtml).toHaveBeenCalledWith(view.estimates[0]);
  });

  it("offers no decisions in the staff preview, and no dead buttons on a decided estimate", async () => {
    const decided: PortalViewData = { ...view, estimates: [{ ...view.estimates[0], status: "approved", signed: true }], proposals: [] };
    render(<PortalView view={decided} loaders={loaders} />);
    await user().click(screen.getByRole("button", { name: "Estimate #1042-1 Storefront door" }));
    const pane = screen.getByRole("region", { name: "Document" });
    expect(within(pane).queryByRole("button", { name: /approve/i })).toBeNull();
    expect(within(pane).queryByRole("button", { name: /decline/i })).toBeNull();
    expect(within(pane).getByText("APPROVED")).toBeInTheDocument();
  });

  it("an invoice that asks for a signature says Sign & pay; a settled one offers nothing to pay", async () => {
    const actions = { onPay: vi.fn() };
    render(<PortalView view={view} loaders={loaders} actions={actions} />);
    await user().click(screen.getByRole("button", { name: "Invoice #1043" }));
    const pane = screen.getByRole("region", { name: "Document" });
    expect(within(pane).getByText(/balance: \$120\.50/i)).toBeInTheDocument();
    await user().click(within(pane).getByRole("button", { name: /sign & pay invoice/i }));
    expect(actions.onPay).toHaveBeenCalledWith(view.invoices[1]);
    await user().click(screen.getByRole("button", { name: "Invoice #1042" }));
    expect(within(screen.getByRole("region", { name: "Document" })).queryByRole("button", { name: /pay/i })).toBeNull();
  });

  it("a proposal shows its options side by side on a PROPOSAL sheet; View Option opens one with a way back", async () => {
    render(<PortalView view={view} loaders={loaders} />);
    await user().click(screen.getByRole("button", { name: "Proposal #256" }));
    const pane = screen.getByRole("region", { name: "Document" });
    expect(within(pane).getByRole("heading", { name: "Proposal #256" })).toBeInTheDocument();
    // Workiz's sheet: the company on the left, PROPOSAL on the right, an option per card.
    const sheet = within(pane).getByRole("group", { name: "Proposal options" });
    expect(within(sheet).getByText("PROPOSAL")).toBeInTheDocument();
    expect(within(sheet).getByText("Acme Locks")).toBeInTheDocument();
    expect(within(sheet).getByText("9 Lite")).toBeInTheDocument();
    expect(within(sheet).getByText("16 Lite")).toBeInTheDocument();
    const buttons = within(pane).getAllByRole("button", { name: /view option/i });
    await user().click(buttons[1]);
    expect(within(screen.getByRole("region", { name: "Document" })).getByRole("heading", { name: /estimate #1042-3/i })).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: /back to proposal #256/i }));
    expect(within(screen.getByRole("region", { name: "Document" })).getByRole("heading", { name: "Proposal #256" })).toBeInTheDocument();
  });

  it("marks the chosen option once the proposal is decided", async () => {
    const decided: PortalViewData = {
      ...view,
      proposals: [{ ...view.proposals[0], status: "approved", selectedEstimateId: "e3" }],
    };
    render(<PortalView view={decided} loaders={loaders} />);
    await user().click(screen.getByRole("button", { name: "Proposal #256" }));
    expect(screen.getByText("Selected option")).toBeInTheDocument();
  });

  it("My Booking lists upcoming and completed jobs with when, where and who, and an Add to calendar file", async () => {
    render(<PortalView view={view} loaders={loaders} />);
    await user().click(screen.getByRole("tab", { name: "My Booking" }));
    const upcoming = screen.getByRole("region", { name: "Upcoming" });
    expect(within(upcoming).getByText("Lock change")).toBeInTheDocument();
    expect(within(upcoming).getByText(/1 Main St, Hartford/)).toBeInTheDocument();
    expect(within(upcoming).getByText("Mike Smith")).toBeInTheDocument();
    expect(within(upcoming).getByText(/Oct 5/)).toBeInTheDocument();
    expect(within(upcoming).getByRole("link", { name: /add to calendar/i })).toHaveAttribute("href", expect.stringContaining("data:text/calendar"));
    expect(within(screen.getByRole("region", { name: "Completed" })).getByText("Rekey")).toBeInTheDocument();
  });

  it("the avatar opens the profile: contact details and the payment history, without card numbers", async () => {
    render(<PortalView view={view} loaders={loaders} />);
    await user().click(screen.getByRole("button", { name: /your profile/i }));
    expect(screen.getByRole("heading", { name: "Your Profile" })).toBeInTheDocument();
    expect(screen.getByText("jane@client.test")).toBeInTheDocument();
    const history = screen.getByRole("region", { name: "Payment history" });
    expect(within(history).getByText("$50.46")).toBeInTheDocument();
    expect(within(history).getByText(/visa ···· 4061/)).toBeInTheDocument();
    expect(within(history).getByText("Paid")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByRole("tab", { name: "Inbox" })).toBeInTheDocument();
  });

  it("says so once, kindly, when there is nothing yet; labels unsent documents only in preview", () => {
    const { rerender } = render(<PortalView view={{ ...view, estimates: [], invoices: [], proposals: [] }} loaders={loaders} />);
    expect(screen.getByText(/nothing to show yet/i)).toBeInTheDocument();
    rerender(<PortalView view={{ ...view, preview: true, invoices: [{ ...view.invoices[0], sent: false }] }} loaders={loaders} />);
    expect(screen.getByText("UNSENT")).toBeInTheDocument();
  });
});

/**
 * The logo has no width until it has loaded, so the company's name beside it
 * slid sideways a moment after the page appeared. The name now waits, out of
 * sight in the place it will keep, for the logo to load (or fail, or two
 * seconds to pass) and appears where it stays.
 */
describe("the header does not slide", () => {
  const nameBlock = () => screen.getAllByText("Acme Locks")[0].parentElement as HTMLElement;

  it("keeps the name out of sight until the logo has loaded", async () => {
    const { container } = render(<PortalView view={view} loaders={loaders} />);
    expect(nameBlock().className).toMatch(/\binvisible\b/);

    const logo = container.querySelector("header img") as HTMLImageElement;
    logo.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(nameBlock().className).not.toMatch(/\binvisible\b/));
  });

  it("shows the name if the logo fails to load", async () => {
    const { container } = render(<PortalView view={view} loaders={loaders} />);
    (container.querySelector("header img") as HTMLImageElement).dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(nameBlock().className).not.toMatch(/\binvisible\b/));
  });

  it("shows the name at once when there is no logo", () => {
    render(<PortalView view={{ ...view, business: { ...view.business, logoUrl: undefined } }} loaders={loaders} />);
    expect(nameBlock().className).not.toMatch(/\binvisible\b/);
  });
});

describe("page states", () => {
  it("a dead link names the business when it knows it", () => {
    render(<InvalidPortalLink businessName="Acme Locks" />);
    expect(screen.getByText("This link is no longer valid")).toBeInTheDocument();
    expect(screen.getByText(/contact Acme Locks for a new link/i)).toBeInTheDocument();
  });

  it("a load failure offers a retry", async () => {
    const onRetry = vi.fn();
    render(<PortalLoadError onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("chip shape", () => {
  it("is a near-square label, not an oval — same rule as the CRM", () => {
    const source = readFileSync(join(__dirname, "portal-view.tsx"), "utf8");
    const chip = source.split("const chip =")[1].split(";")[0];
    expect(chip).toContain("rounded-chip");
    expect(chip).not.toContain("rounded-full");
  });
});

describe("the paged inbox — Load more and Inbox Display", () => {
  const inv = (n: number) => ({
    kind: "invoice" as const, id: `i${n}`, number: `N${n}`, date: `2026-08-${String(n).padStart(2, "0")}`, status: "due" as const,
    total: n, balanceDue: n, sent: true,
  });
  const paged: PortalViewData = {
    ...view,
    estimates: [],
    proposals: [],
    invoices: [inv(20), inv(19)],
    inbox: { total: 3, nextCursor: "cur-1" },
  };
  const nextPage: PortalInboxPage = { invoices: [inv(18)], estimates: [], proposals: [], inbox: { total: 3 } };
  const cards = () => within(screen.getByRole("region", { name: "Your inbox" })).getAllByRole("button", { name: /^Invoice #/ }).map((b) => b.getAttribute("aria-label"));

  it("shows the whole inbox's count, and Load more brings the next ten until there are no more", async () => {
    const loadInbox = vi.fn(async () => nextPage);
    render(<PortalView view={paged} loaders={loaders} loadInbox={loadInbox} />);
    expect(screen.getByRole("heading", { name: "Your Inbox (3)" })).toBeInTheDocument();
    expect(cards()).toEqual(["Invoice #N20", "Invoice #N19"]);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadInbox).toHaveBeenCalledWith({ cursor: "cur-1", limit: 10, show: ["invoices", "estimates", "paid", "unpaid"] });
    expect(await screen.findByRole("button", { name: "Invoice #N18" })).toBeInTheDocument();
    expect(cards()).toEqual(["Invoice #N20", "Invoice #N19", "Invoice #N18"]);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("says when Load more failed and lets the client try again", async () => {
    const loadInbox = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(nextPage);
    render(<PortalView view={paged} loaders={loaders} loadInbox={loadInbox} />);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load more/i);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("button", { name: "Invoice #N18" })).toBeInTheDocument();
  });

  it("the settings button opens Inbox Display: Display All, Invoices, Estimates, Paid, Unpaid, N Selected, Done", async () => {
    const filtered: PortalInboxPage = { invoices: [inv(19)], estimates: [], proposals: [], inbox: { total: 1 } };
    const loadInbox = vi.fn(async () => filtered);
    render(<PortalView view={paged} loaders={loaders} loadInbox={loadInbox} />);
    await userEvent.click(screen.getByRole("button", { name: "Inbox display" }));
    const menu = screen.getByRole("dialog", { name: "Inbox Display:" });
    for (const box of ["Display All", "Invoices", "Estimates", "Paid", "Unpaid"]) {
      expect(within(menu).getByRole("checkbox", { name: box })).toBeChecked();
    }
    expect(within(menu).getByText("5 Selected")).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole("checkbox", { name: "Paid" }));
    expect(within(menu).getByRole("checkbox", { name: "Display All" })).not.toBeChecked();
    expect(within(menu).getByText("3 Selected")).toBeInTheDocument();
    // Nothing is asked for until Done.
    expect(loadInbox).not.toHaveBeenCalled();
    await userEvent.click(within(menu).getByRole("button", { name: "Done" }));

    expect(loadInbox).toHaveBeenCalledWith({ limit: 10, show: ["invoices", "estimates", "unpaid"] });
    expect(await screen.findByRole("heading", { name: "Your Inbox (1)" })).toBeInTheDocument();
    expect(cards()).toEqual(["Invoice #N19"]);
    expect(screen.queryByRole("dialog", { name: "Inbox Display:" })).not.toBeInTheDocument();
  });

  it("Display All turns every box off and on; Done needs at least one", async () => {
    render(<PortalView view={paged} loaders={loaders} loadInbox={vi.fn(async () => nextPage)} />);
    await userEvent.click(screen.getByRole("button", { name: "Inbox display" }));
    const menu = screen.getByRole("dialog", { name: "Inbox Display:" });
    await userEvent.click(within(menu).getByRole("checkbox", { name: "Display All" }));
    for (const box of ["Invoices", "Estimates", "Paid", "Unpaid"]) {
      expect(within(menu).getByRole("checkbox", { name: box })).not.toBeChecked();
    }
    expect(within(menu).getByText("0 Selected")).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Done" })).toBeDisabled();
    await userEvent.click(within(menu).getByRole("checkbox", { name: "Display All" }));
    expect(within(menu).getByRole("checkbox", { name: "Unpaid" })).toBeChecked();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Inbox Display:" })).not.toBeInTheDocument();
  });

  it("a filter that matches nothing says so, with a way back to everything", async () => {
    const none: PortalInboxPage = { invoices: [], estimates: [], proposals: [], inbox: { total: 0 } };
    const loadInbox = vi.fn().mockResolvedValueOnce(none).mockResolvedValueOnce({ ...nextPage, invoices: [inv(20)] });
    render(<PortalView view={paged} loaders={loaders} loadInbox={loadInbox} />);
    await userEvent.click(screen.getByRole("button", { name: "Inbox display" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Invoices" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(loadInbox).toHaveBeenLastCalledWith({ limit: 10, show: ["invoices", "estimates", "paid", "unpaid"] });
    expect(await screen.findByRole("button", { name: "Invoice #N20" })).toBeInTheDocument();
  });

  it("after a reload (a payment, a signature) the client keeps everything they had scrolled to", async () => {
    const refreshed: PortalInboxPage = { invoices: [inv(20), inv(19), { ...inv(18), status: "paid", balanceDue: 0 }], estimates: [], proposals: [], inbox: { total: 3 } };
    const loadInbox = vi.fn().mockResolvedValueOnce(nextPage).mockResolvedValueOnce(refreshed);
    const { rerender } = render(<PortalView view={paged} loaders={loaders} loadInbox={loadInbox} />);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("button", { name: "Invoice #N18" });
    rerender(<PortalView view={{ ...paged }} loaders={loaders} loadInbox={loadInbox} />);
    expect(loadInbox).toHaveBeenLastCalledWith({ limit: 3, show: ["invoices", "estimates", "paid", "unpaid"] });
    expect(await screen.findByText("PAID")).toBeInTheDocument();
    expect(cards()).toEqual(["Invoice #N20", "Invoice #N19", "Invoice #N18"]);
  });

  it("without a page loader (an older host) the inbox reads as before: no Load more, no filter", () => {
    render(<PortalView view={paged} loaders={loaders} />);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inbox display" })).not.toBeInTheDocument();
  });
});
