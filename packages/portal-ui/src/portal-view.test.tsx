import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortalView as PortalViewData } from "@bitcrm/types";
import { InvalidPortalLink, PortalLoadError, PortalView } from "./portal-view";

const view: PortalViewData = {
  business: {
    name: "Acme Locks",
    phone: "+1 (404) 555-0100",
    email: "hi@acme.test",
    logoUrl: "https://files.test/logo.png",
  },
  client: { firstName: "Jane", lastName: "Smith" },
  estimates: [
    { kind: "estimate", id: "e1", number: "1042-1", name: "Good", date: "2026-09-10", status: "pending", total: 250, sent: true },
  ],
  invoices: [
    {
      kind: "invoice", id: "d1", number: "1042", date: "2026-09-12", status: "overdue", total: 300,
      balanceDue: 120.5, dueDate: "2026-09-13", sent: false,
    },
  ],
  preview: false,
};

describe("PortalView", () => {
  it("greets the client, names the business and offers a call / email shortcut", () => {
    render(<PortalView view={view} onOpen={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Hi Jane," })).toBeInTheDocument();
    expect(screen.getByText("Here are your documents from Acme Locks.")).toBeInTheDocument();
    expect(screen.getByText("Acme Locks", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\(404\) 555-0100/ })).toHaveAttribute("href", "tel:+14045550100");
    expect(screen.getByRole("link", { name: /hi@acme.test/ })).toHaveAttribute("href", "mailto:hi@acme.test");
  });

  it("lists both sections with status, amount owed and due date", () => {
    render(<PortalView view={view} onOpen={() => {}} />);
    const estimates = screen.getByRole("region", { name: "Estimates" });
    expect(within(estimates).getByText("Good")).toBeInTheDocument();
    expect(within(estimates).getByText("Pending")).toBeInTheDocument();
    expect(within(estimates).getByText("$250.00")).toBeInTheDocument();

    const invoices = screen.getByRole("region", { name: "Invoices" });
    expect(within(invoices).getByText("Overdue")).toBeInTheDocument();
    expect(within(invoices).getByText(/\$120\.50 due/)).toBeInTheDocument();
    expect(within(invoices).getByText(/due sep 13, 2026/i)).toBeInTheDocument();
  });

  it("puts what the client owes up top, and opens the single open invoice from it", async () => {
    const onOpen = vi.fn();
    render(<PortalView view={view} onOpen={onOpen} />);
    const balance = screen.getByRole("region", { name: "Balance due" });
    expect(within(balance).getByText("Balance overdue")).toBeInTheDocument();
    expect(within(balance).getByText("$120.50")).toBeInTheDocument();
    expect(within(balance).getByText("on 1 invoice")).toBeInTheDocument();
    await userEvent.click(within(balance).getByRole("button", { name: /view invoice #1042/i }));
    expect(onOpen).toHaveBeenCalledWith(view.invoices[0]);
  });

  it("shows no balance card when nothing is owed, and skips empty sections", () => {
    const paid: PortalViewData = {
      ...view,
      estimates: [],
      invoices: [{ ...view.invoices[0], status: "paid", balanceDue: 0 }],
    };
    render(<PortalView view={paid} onOpen={() => {}} />);
    expect(screen.queryByRole("region", { name: /balance/i })).toBeNull();
    expect(screen.queryByRole("region", { name: "Estimates" })).toBeNull();
    expect(screen.getByRole("region", { name: "Invoices" })).toBeInTheDocument();
  });

  it("says so once, kindly, when there is nothing yet", () => {
    render(<PortalView view={{ ...view, estimates: [], invoices: [] }} onOpen={() => {}} />);
    expect(screen.getByText(/nothing to show yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Invoices" })).toBeNull();
  });

  it("names the company a document is from", () => {
    render(<PortalView view={{ ...view, estimates: [{ ...view.estimates[0], companyName: "KeyPro" }] }} onOpen={() => {}} />);
    expect(within(screen.getByRole("region", { name: "Estimates" })).getByText("KeyPro")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Invoices" })).queryByText("KeyPro")).toBeNull();
  });

  it("labels unsent documents only in preview", () => {
    const { rerender } = render(<PortalView view={view} onOpen={() => {}} />);
    expect(screen.queryByText("UNSENT")).toBeNull();
    rerender(<PortalView view={{ ...view, preview: true }} onOpen={() => {}} />);
    expect(screen.getByText("UNSENT")).toBeInTheDocument();
  });

  it("opens a document from its card", async () => {
    const onOpen = vi.fn();
    render(<PortalView view={view} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Estimate #1042-1 Good" }));
    expect(onOpen).toHaveBeenCalledWith(view.estimates[0]);
  });

  it("falls back to initials without a logo, and to a plain hello without a first name", () => {
    render(<PortalView view={{ ...view, business: { name: "Acme Locks" }, client: { firstName: "", lastName: "" } }} onOpen={() => {}} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Hello," })).toBeInTheDocument();
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
    // The portal shares its look with apps/web, where labels are
    // `rounded-chip` (2px) and only real circles stay round.
    const source = readFileSync(
      join(__dirname, "portal-view.tsx"),
      "utf8",
    );
    const chip = source.split("const chip =")[1].split(";")[0];
    expect(chip).toContain("rounded-chip");
    expect(chip).not.toContain("rounded-full");
  });
});
