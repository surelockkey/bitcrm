import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortalView as PortalViewData } from "@bitcrm/types";
import { PortalView } from "./portal-view";

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
  it("shows the business header, greeting and both document sections", () => {
    render(<PortalView view={view} onOpen={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Acme Locks" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Acme Locks" })).toHaveAttribute("src", "https://files.test/logo.png");
    expect(screen.getByRole("link", { name: /\(404\) 555-0100/ })).toHaveAttribute("href", "tel:+14045550100");
    expect(screen.getByRole("link", { name: "hi@acme.test" })).toHaveAttribute("href", "mailto:hi@acme.test");
    expect(screen.getByText("Hi Jane, here are your documents from Acme Locks")).toBeInTheDocument();

    const estimates = screen.getByRole("region", { name: "Estimates" });
    expect(within(estimates).getByText("Good")).toBeInTheDocument();
    expect(within(estimates).getByText("Pending")).toBeInTheDocument();
    expect(within(estimates).getByText("$250.00")).toBeInTheDocument();

    const invoices = screen.getByRole("region", { name: "Invoices" });
    expect(within(invoices).getByText("Overdue")).toBeInTheDocument();
    expect(within(invoices).getByText(/\$120\.50 due/)).toBeInTheDocument();
    expect(within(invoices).getByText(/due sep 13, 2026/i)).toBeInTheDocument();
  });

  it("names the company each document is from", () => {
    const withCompany: PortalViewData = {
      ...view,
      estimates: [{ ...view.estimates[0], companyName: "KeyPro" }],
    };
    render(<PortalView view={withCompany} onOpen={() => {}} />);
    const estimates = screen.getByRole("region", { name: "Estimates" });
    expect(within(estimates).getByText("KeyPro")).toBeInTheDocument();
    const invoices = screen.getByRole("region", { name: "Invoices" });
    expect(within(invoices).queryByText("KeyPro")).toBeNull();
  });

  it("labels unsent documents only in preview", () => {
    const { rerender } = render(<PortalView view={view} onOpen={() => {}} />);
    expect(screen.queryByText("UNSENT")).toBeNull();
    rerender(<PortalView view={{ ...view, preview: true }} onOpen={() => {}} />);
    expect(screen.getByText("UNSENT")).toBeInTheDocument();
  });

  it("opens a document on click", async () => {
    const onOpen = vi.fn();
    render(<PortalView view={view} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /invoice #1042/i }));
    expect(onOpen).toHaveBeenCalledWith(view.invoices[0]);
  });

  it("shows empty states", () => {
    render(<PortalView view={{ ...view, estimates: [], invoices: [] }} onOpen={() => {}} />);
    expect(screen.getByText(/no estimates to show/i)).toBeInTheDocument();
    expect(screen.getByText(/no invoices to show/i)).toBeInTheDocument();
  });
});
