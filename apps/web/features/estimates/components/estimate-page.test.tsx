import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { EstimateWithItems } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/estimates/e1",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("@/features/deals/hooks", () => ({
  // An answered query: the page waits for the job's items before it shows.
  useDealProducts: () => ({ data: [], isLoading: false, isError: false, isPending: false, fetchStatus: "idle" }),
  useDeal: (id: string) => ({
    data: id ? { id, dealNumber: "1042", contactId: "c1", assignedTechIds: [], address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" } } : undefined,
    isLoading: false,
  }),
}));
vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({
    data: {
      id: "c1", firstName: "Jane", lastName: "Client", phones: ["+18605550199"], emails: ["jane@client.test"],
      addresses: [{ street: "100 Park Blvd", city: "San Diego", state: "CA", zip: "92101" }],
    },
  }),
}));
vi.mock("@/features/billing/components/document-summary-panel", () => ({
  DocumentSummaryPanel: ({ totals, extraRows }: { totals: { total: number }; extraRows?: React.ReactNode }) => (
    <div data-testid="summary">
      {totals.total}
      {extraRows}
    </div>
  ),
  Row: ({ label, value, action }: { label: React.ReactNode; value: React.ReactNode; action?: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      {action}
      <span>{value}</span>
    </div>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { usePageHistoryStore } from "@/stores/page-history-store";
import { StandaloneEstimatePage } from "./estimate-page";

const totals = {
  lineCount: 0, subtotal: 0, taxableSubtotal: 0, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 0, taxRatePercent: 0, tax: 0, total: 0, amountPaid: 0, balanceDue: 0,
};
const estimate = (over: Partial<EstimateWithItems> = {}): EstimateWithItems => ({
  id: "e9", number: "1141", contactId: "c1", status: "unsent", estimateDate: "2026-09-16", totals,
  version: 1, createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z",
  items: [], ...over,
});

beforeEach(() => {
  mocks.push.mockClear();
  mocks.replace.mockClear();
  server.use(
    http.get("*/billing/templates", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/billing/document-settings", () => HttpResponse.json({ success: true, data: {} })),
    http.get("*/deals/tax-rates", () => HttpResponse.json({ success: true, data: [] })),
  );
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const line = {
  lineId: "l1", estimateId: "e1", position: 0, productId: "p1", name: "Deadbolt", sku: "DB",
  quantity: 1, priceClient: 80, costCompany: 10, costForTech: 20, taxable: true, createdAt: "", updatedAt: "",
};

/** Workiz: a client's estimate (no job) has its own layout — Client, Bill to, the estimate's number, name, date, status. */
describe("StandaloneEstimatePage — a client estimate", () => {
  it("lays it out as Workiz does: Client and Bill to on the left, Estimate / name / date / status on the right", async () => {
    server.use(http.get("*/billing/estimates/e9", () => HttpResponse.json({ success: true, data: estimate() })));
    renderWithClient(<StandaloneEstimatePage estimateId="e9" />);
    expect(await screen.findByText("Client:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jane Client" })).toHaveAttribute("href", "/contacts/c1");
    expect(screen.getByText("Bill to:")).toBeInTheDocument();
    expect(screen.getByText(/100 Park Blvd/)).toBeInTheDocument();
    expect(screen.getByText("jane@client.test")).toBeInTheDocument();
    expect(screen.getByText("Estimate:")).toBeInTheDocument();
    expect(screen.getByText("1141")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimate name")).toBeInTheDocument();
    // Workiz prints the day as "Thu Jun 18 2026", underlined, and opens a calendar on it.
    expect(screen.getByLabelText("Date")).toHaveTextContent("Wed Sep 16 2026");
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    // No job yet: nothing to sync to, and no job tabs or cover/description (those are a job's proposal).
    expect(screen.queryByRole("tablist", { name: "Estimates" })).not.toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /price book/i })).toHaveAttribute("href", "/inventory/items");
    expect(screen.queryByRole("button", { name: /sync to job/i })).not.toBeInTheDocument();
    // Workiz's empty grid: its art and "Add items".
    expect(screen.getByRole("button", { name: "Add items" })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("changes the day from the calendar under it", async () => {
    let body: unknown;
    server.use(
      http.get("*/billing/estimates/e9", () => HttpResponse.json({ success: true, data: estimate() })),
      http.patch("*/billing/estimates/e9", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: estimate({ estimateDate: "2026-09-20" }) });
      }),
    );
    renderWithClient(<StandaloneEstimatePage estimateId="e9" />);
    await user().click(await screen.findByLabelText("Date"));
    await user().click(await screen.findByRole("button", { name: "Choose Sunday, September 20th, 2026" }));
    await waitFor(() => expect(body).toEqual({ estimateDate: "2026-09-20" }));
  });

  it("shows the notes with Workiz's (Edit), which opens them to change; leaving saves", async () => {
    let body: unknown;
    server.use(
      http.get("*/billing/estimates/e9", () => HttpResponse.json({ success: true, data: estimate({ notes: "Thank you!" }) })),
      http.patch("*/billing/estimates/e9", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: estimate({ notes: "Thanks, Jane" }) });
      }),
    );
    renderWithClient(<StandaloneEstimatePage estimateId="e9" />);
    expect(await screen.findByText("Thank you!")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Estimate notes" })).not.toBeInTheDocument();
    const u = user();
    await u.click(screen.getByRole("button", { name: "(Edit)" }));
    const box = screen.getByRole("textbox", { name: "Estimate notes" });
    expect(box).toHaveFocus();
    await u.clear(box);
    await u.type(box, "Thanks, Jane");
    await u.tab();
    await waitFor(() => expect(body).toEqual({ notes: "Thanks, Jane" }));
  });

  it("goes to a job through Actions → Copy to job, once it has items", async () => {
    server.use(http.get("*/billing/estimates/e9", () => HttpResponse.json({ success: true, data: estimate({ items: [{ ...line, estimateId: "e9" }] }) })));
    renderWithClient(<StandaloneEstimatePage estimateId="e9" />);
    await user().click(await screen.findByRole("button", { name: /^actions$/i }));
    expect(await screen.findByRole("menuitem", { name: /copy to job/i })).toHaveAttribute(
      "href",
      "/deals/new?contactId=c1&then=copy-estimate%3Ae9",
    );
  });
});

/** Workiz: a job's estimate opens on its own page too — "← Job ID" back to the job, the job's estimates as tabs. */
describe("StandaloneEstimatePage — a job's estimate", () => {
  const e1 = estimate({ id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042", name: "Good", items: [line] });
  const e2 = estimate({ id: "e2", number: "1042-2", dealId: "d1", dealNumber: "1042", name: "Better", createdAt: "2026-09-16T12:00:00.000Z" });

  beforeEach(() => {
    server.use(
      http.get("*/billing/estimates/e1", () => HttpResponse.json({ success: true, data: e1 })),
      http.get("*/billing/estimates/by-deal/d1", () => HttpResponse.json({ success: true, data: [e2, e1] })),
    );
  });

  it("names its crumb 'Estimate (1)' — the estimate's number on the job — as Workiz's strip does", async () => {
    usePageHistoryStore.setState({ visits: [], labels: {} });
    renderWithClient(<StandaloneEstimatePage estimateId="e1" />);
    await screen.findByRole("link", { name: /job id:\s*1042/i });
    await waitFor(() => expect(usePageHistoryStore.getState().labels["/estimates/e1"]).toBe("Estimate (1)"));
  });

  it("puts ← Job ID back to the job's Estimates above the tabs of the job's estimates", async () => {
    renderWithClient(<StandaloneEstimatePage estimateId="e1" />);
    expect(await screen.findByRole("link", { name: /job id:\s*1042/i })).toHaveAttribute("href", "/deals/d1?tab=estimates");
    const tabs = await screen.findByRole("tablist", { name: "Estimates" });
    const first = await within(tabs).findByRole("tab", { name: /good/i });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("href", "/estimates/e1");
    expect(within(tabs).getByRole("tab", { name: /better/i })).toHaveAttribute("href", "/estimates/e2");
    // Workiz's job-estimate header and toolbar.
    expect(screen.getByText("Client details")).toBeInTheDocument();
    expect(screen.getByText("Service address")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync to job/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create new job/i })).toHaveAttribute(
      "href",
      "/deals/new?contactId=c1&then=copy-estimate%3Ae1",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("renames the estimate in its tab and keeps its date and template in the band", async () => {
    let body: unknown;
    server.use(
      http.patch("*/billing/estimates/e1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...e1, name: "Best" } });
      }),
    );
    renderWithClient(<StandaloneEstimatePage estimateId="e1" />);
    expect(await screen.findByLabelText("Date")).toHaveTextContent("Wed Sep 16 2026");
    expect(screen.getByLabelText("Template")).toBeInTheDocument();
    expect(screen.getByText("Estimate no.")).toBeInTheDocument();
    const u = user();
    await u.click(screen.getByRole("button", { name: "Rename estimate" }));
    const box = screen.getByRole("textbox", { name: "Estimate name" });
    await u.clear(box);
    await u.type(box, "Best{Enter}");
    await waitFor(() => expect(body).toEqual({ name: "Best" }));
  });

  it("writes the description in Workiz's small window, opened from (+Add)", async () => {
    let body: unknown;
    server.use(
      http.patch("*/billing/estimates/e1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...e1, description: "Grade 1 hardware" } });
      }),
    );
    renderWithClient(<StandaloneEstimatePage estimateId="e1" />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Add description" }));
    const dialog = await screen.findByRole("dialog", { name: "Description" });
    await u.type(within(dialog).getByRole("textbox", { name: "Description" }), "Grade 1 hardware");
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body).toEqual({ description: "Grade 1 hardware" }));
  });

  it("Send offers this estimate or all of the job's open ones as a proposal", async () => {
    renderWithClient(<StandaloneEstimatePage estimateId="e1" />);
    // Both of the job's open estimates are known once the tabs show them.
    await within(await screen.findByRole("tablist", { name: "Estimates" })).findByRole("tab", { name: /better/i });
    await user().click(await screen.findByRole("button", { name: /^send$/i }));
    expect(await screen.findByRole("menuitem", { name: /send estimate/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /send all \(proposal\)/i })).toBeInTheDocument();
  });
});
