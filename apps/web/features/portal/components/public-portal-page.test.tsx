import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { PublicPortalPage } from "./public-portal-page";

const view = {
  business: { name: "Acme Locks" },
  client: { firstName: "Jane", lastName: "Smith" },
  estimates: [],
  invoices: [
    { kind: "invoice", id: "d1", number: "1042", date: "2026-09-12", status: "due", total: 300, balanceDue: 300, dueDate: "2026-09-20", sent: true },
  ],
  preview: false,
};

describe("PublicPortalPage", () => {
  it("renders the client's documents and opens the PDF viewer", async () => {
    server.use(
      http.get("*/billing/public/portal/tok1", () => HttpResponse.json({ success: true, data: view })),
      http.get("*/billing/public/portal/tok1/invoice/d1/pdf", () =>
        HttpResponse.json({ success: true, data: { url: "https://files.test/inv.pdf" } }),
      ),
    );
    renderWithClient(<PublicPortalPage token="tok1" />);
    expect(await screen.findByText("Hi Jane, here are your documents from Acme Locks")).toBeInTheDocument();
    await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByRole("button", { name: /invoice #1042/i }));
    const frame = await screen.findByTitle("Invoice #1042");
    await waitFor(() => expect(frame).toHaveAttribute("src", "https://files.test/inv.pdf"));
    expect(screen.getByRole("link", { name: /open in new tab/i })).toHaveAttribute("href", "https://files.test/inv.pdf");
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeInTheDocument();
  });

  it("explains an invalid link, naming the business when the API does", async () => {
    server.use(
      http.get("*/billing/public/portal/dead", () =>
        HttpResponse.json({ success: false, error: { message: "Not found", businessName: "Acme Locks" } }, { status: 404 }),
      ),
    );
    renderWithClient(<PublicPortalPage token="dead" />);
    expect(await screen.findByText("This link is no longer valid")).toBeInTheDocument();
    expect(screen.getByText(/please contact acme locks/i)).toBeInTheDocument();
  });

  it("offers a retry on a server error", async () => {
    server.use(http.get("*/billing/public/portal/flaky", () => HttpResponse.json({ success: false }, { status: 500 })));
    renderWithClient(<PublicPortalPage token="flaky" />);
    expect(await screen.findByRole("button", { name: /try again/i }, { timeout: 5000 })).toBeInTheDocument();
  });
});
