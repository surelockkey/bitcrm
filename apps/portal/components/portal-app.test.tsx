import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortalView } from "@bitcrm/types";
import { PortalApp } from "./portal-app";

const view: PortalView = {
  business: { name: "Acme Locks", phone: "+14045550100" },
  client: { firstName: "Jane", lastName: "Smith" },
  estimates: [],
  invoices: [
    { kind: "invoice", id: "d1", number: "1042", date: "2026-09-12", status: "due", total: 300, balanceDue: 300, sent: true },
  ],
  preview: false,
};

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const fail = (status: number, body: unknown = { success: false, message: "no" }) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("PortalApp", () => {
  it("loads the portal for the token and shows the client's documents", async () => {
    const f = vi.fn(async () => ok(view));
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);
    expect(screen.getByRole("status", { name: /loading your documents/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Hi Jane," })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invoice #1042" })).toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("opens an invoice as a page: the HTML render is fetched, the PDF is not", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/html") ? ok({ html: "<html><head></head><body>invoice</body></html>" }) : ok(view),
    );
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice #1042" }));
    expect(await screen.findByTitle("Invoice #1042")).toBeInTheDocument();
    const urls = f.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toContain("https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/invoice/d1/html");
    expect(urls.some((u) => u.includes("/pdf"))).toBe(false);
  });

  it("shows the dead-link page (with the business name) for a revoked link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(404, { success: false, message: "gone", businessName: "Acme Locks" })));
    render(<PortalApp token="tok" />);
    expect(await screen.findByText("This link is no longer valid")).toBeInTheDocument();
    expect(screen.getByText(/contact Acme Locks/i)).toBeInTheDocument();
  });

  it("offers a retry on a transient failure, and recovers", async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValue(ok(view));
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: "Hi Jane," })).toBeInTheDocument();
  });
});
