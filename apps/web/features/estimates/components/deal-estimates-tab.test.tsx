import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Deal, EstimateWithItems } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { queryKeys } from "@/lib/query-keys";

const mocks = vi.hoisted(() => ({
  products: [{ productId: "a" }, { productId: "b" }, { productId: "c" }] as { productId: string }[],
  perms: new Set<string>(),
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`) }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useDealProducts: () => ({ data: mocks.products, isLoading: false }),
}));
// The summary panel pulls the tax catalog; not under test here.
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
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { DealEstimatesTab } from "./deal-estimates-tab";
import { EstimateEditor } from "./estimate-editor";

const deal = { id: "d1", dealNumber: "1042", contactId: "c1", assignedTechIds: [] } as unknown as Deal;
const totals = {
  lineCount: 1, subtotal: 80, taxableSubtotal: 80, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 80, taxRatePercent: 0, tax: 0, total: 80, amountPaid: 0, balanceDue: 80,
};
const estimate: EstimateWithItems = {
  id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042", contactId: "c1", name: "Good",
  status: "pending", estimateDate: "2026-09-16", totals, version: 1, createdBy: "u1",
  createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z",
  items: [
    {
      lineId: "l1", estimateId: "e1", position: 0, productId: "p1", name: "Deadbolt", sku: "DB",
      quantity: 1, priceClient: 80, costCompany: 10, costForTech: 20, taxable: true,
      createdAt: "", updatedAt: "",
    },
  ],
};

function Harness({ initial = null, startCreating }: { initial?: string | null; startCreating?: boolean }) {
  return <DealEstimatesTab deal={deal} estimateId={initial} startCreating={startCreating} />;
}
/**
 * The estimate itself — it now opens on a page of its own (`/estimates/[id]`),
 * which holds the job's items and tells the editor how many there are.
 */
const Editor = () => (
  <EstimateEditor estimateId="e1" deal={deal} jobItemCount={mocks.products.length} onOpenEstimate={() => {}} />
);
const second: EstimateWithItems = {
  ...estimate, id: "e2", number: "1042-2", name: undefined, status: "unsent",
  createdAt: "2026-09-16T12:00:00.000Z", totals: { ...totals, total: 120, subtotal: 120 },
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const ALL = ["view", "create", "edit", "delete", "send", "sync"].map((a) => `estimates.${a}`);

beforeEach(() => {
  mocks.perms = new Set(ALL);
  mocks.push.mockClear();
  mocks.replace.mockClear();
  server.use(
    http.get("*/billing/templates", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/billing/estimates/by-deal/d1", () => HttpResponse.json({ success: true, data: [estimate] })),
    http.get("*/billing/estimates/e1", () => HttpResponse.json({ success: true, data: estimate })),
    http.get("*/billing/document-settings", () => HttpResponse.json({ success: true, data: {} })),
    http.get("*/crm/contacts/c1", () =>
      HttpResponse.json({ success: true, data: { id: "c1", firstName: "Jane", lastName: "Client", phones: [], emails: [], addresses: [] } }),
    ),
  );
});

describe("DealEstimatesTab — the job's estimates as a list (Workiz)", () => {
  it("lists every estimate: name / number, created, status, total — each opens on its own page", async () => {
    server.use(
      http.get("*/billing/estimates/by-deal/d1", () => HttpResponse.json({ success: true, data: [second, estimate] })),
    );
    renderWithClient(<Harness />);
    const table = await screen.findByRole("table", { name: /estimates/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    // Oldest first: "Estimate 1" is the first one made.
    expect(within(rows[0]).getByRole("link", { name: "Good" })).toHaveAttribute("href", "/estimates/e1");
    expect(rows[0]).toHaveTextContent("Estimate No. 1042-1");
    expect(rows[0]).toHaveTextContent("Pending");
    expect(rows[0]).toHaveTextContent("$80.00");
    expect(within(rows[1]).getByRole("link", { name: "Estimate 2" })).toHaveAttribute("href", "/estimates/e2");
    expect(rows[1]).toHaveTextContent("Unsent");
    expect(rows[1]).toHaveTextContent("$120.00");
    // The tab is the list; the editor lives on the estimate's page.
    expect(screen.queryByRole("heading", { name: "Items" })).not.toBeInTheDocument();
  });

  it("shows a job without estimates the Workiz way: 'You don't have any estimates yet' and + Add Estimate", async () => {
    server.use(http.get("*/billing/estimates/by-deal/d1", () => HttpResponse.json({ success: true, data: [] })));
    renderWithClient(<Harness />);
    expect(await screen.findByRole("heading", { name: "You don't have any estimates yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add estimate/i })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /estimates/i })).not.toBeInTheDocument();
  });

  it("marks each estimate's status with Workiz's coloured dot", async () => {
    renderWithClient(<Harness />);
    const table = await screen.findByRole("table", { name: /estimates/i });
    const dot = within(table).getByText("Pending").previousElementSibling as HTMLElement;
    expect(dot).toHaveStyle({ backgroundColor: "#FBAB33" });
  });

  it("Add Estimate makes one copying the job items and opens its page", async () => {
    let body: unknown;
    server.use(
      http.post("*/billing/estimates", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...estimate, id: "e2", number: "1042-2", name: "Better" } });
      }),
    );
    renderWithClient(<Harness />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /add estimate/i }));
    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByLabelText(/^name/i), "Better");
    expect(within(dialog).getByRole("checkbox", { name: /copy current job items/i })).toBeChecked();
    await u.click(within(dialog).getByRole("button", { name: /create estimate/i }));
    await waitFor(() => expect(body).toEqual({ dealId: "d1", name: "Better", copyJobItems: true }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/estimates/e2"));
  });

  it("opens the New estimate dialog on arrival when asked to (Create new → Estimate from the client card)", async () => {
    renderWithClient(<Harness startCreating />);
    expect(await screen.findByRole("button", { name: /create estimate/i })).toBeInTheDocument();
  });

  it("hides Add Estimate without create permission", async () => {
    mocks.perms.delete("estimates.create");
    renderWithClient(<Harness />);
    await screen.findByRole("table", { name: /estimates/i });
    expect(screen.queryByRole("button", { name: /add estimate/i })).not.toBeInTheDocument();
  });

  it("offers Send all (Proposal) while an open estimate is not in a proposal yet", async () => {
    mocks.perms.add("messages.send");
    renderWithClient(<Harness />);
    await screen.findByRole("table", { name: /estimates/i });
    expect(screen.getByRole("button", { name: /send all \(proposal\)/i })).toBeInTheDocument();
  });

  it("keeps Send all (Proposal) once the proposal went out, and a retry resends it without making another", async () => {
    mocks.perms.add("messages.send");
    let created = 0;
    let sms: Record<string, unknown> | undefined;
    server.use(
      http.get("*/billing/estimates/by-deal/d1", () =>
        HttpResponse.json({ success: true, data: [{ ...estimate, proposalId: "p1" }, { ...second, status: "pending", proposalId: "p1" }] }),
      ),
      http.get("*/crm/contacts/c1", () =>
        HttpResponse.json({ success: true, data: { id: "c1", firstName: "Jane", lastName: "Client", phones: ["+18605550199"], emails: [], addresses: [] } }),
      ),
      http.get("*/billing/business-profiles", () => HttpResponse.json({ success: true, data: [{ id: "bp1", name: "Sure Lock Key", isDefault: true }] })),
      http.post("*/billing/portal-links/c1/url", () =>
        HttpResponse.json({ success: true, data: { contactId: "c1", createdBy: "u", createdAt: "t", url: "https://portal.test/tok_p", token: "tok_p" } }),
      ),
      http.post("*/billing/proposals", () => {
        created += 1;
        return HttpResponse.json({ success: false, message: "This job has no open estimate to send as a proposal" }, { status: 422 });
      }),
      http.post("*/messaging/messages", async ({ request }) => {
        sms = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: { id: "m1", status: "queued" } }, { status: 202 });
      }),
    );
    renderWithClient(<Harness />);
    await screen.findByRole("table", { name: /estimates/i });
    await user().click(screen.getByRole("button", { name: /send all \(proposal\)/i }));
    const box = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain("https://portal.test/tok_p"));
    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(sms).toBeDefined());
    expect(created).toBe(0);
    expect(sms).toMatchObject({ contactId: "c1", channel: "sms", dealId: "d1" });
  });

  it("hides Send all (Proposal) once no estimate is open", async () => {
    mocks.perms.add("messages.send");
    server.use(
      http.get("*/billing/estimates/by-deal/d1", () =>
        HttpResponse.json({ success: true, data: [{ ...estimate, status: "won", proposalId: "p1" }] }),
      ),
    );
    renderWithClient(<Harness />);
    await screen.findByRole("table", { name: /estimates/i });
    expect(screen.queryByRole("button", { name: /send all \(proposal\)/i })).not.toBeInTheDocument();
  });

  it("a row copies its estimate, and deletes it after asking", async () => {
    let copied = false;
    let deleted = false;
    server.use(
      http.post("*/billing/estimates/e1/duplicate", () => {
        copied = true;
        return HttpResponse.json({ success: true, data: { ...estimate, id: "e3", number: "1042-3" } });
      }),
      http.delete("*/billing/estimates/e1", () => {
        deleted = true;
        return HttpResponse.json({ success: true, data: null });
      }),
    );
    renderWithClient(<Harness />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /make a copy of estimate 1042-1/i }));
    await waitFor(() => expect(copied).toBe(true));
    await u.click(screen.getByRole("button", { name: /delete estimate 1042-1/i }));
    const confirm = await screen.findByRole("alertdialog");
    expect(deleted).toBe(false);
    await u.click(within(confirm).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it("sends an old ?estimate= link to the estimate's own page", async () => {
    renderWithClient(<Harness initial="e1" />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/estimates/e1"));
  });
});

describe("EstimateEditor — sync to job", () => {
  it("a job that already has items asks the Workiz question; Replace is the default and refreshes the job", async () => {
    let body: unknown;
    server.use(
      http.post("*/billing/estimates/e1/sync-to-job", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { estimate: { ...estimate, status: "won" }, itemCount: 1 } });
      }),
    );
    const { client } = renderWithClient(<Editor />);
    const spy = vi.spyOn(client, "invalidateQueries");
    const u = user();
    await u.click(await screen.findByRole("button", { name: /sync to job/i }));
    const dialog = await screen.findByRole("dialog", { name: "This job already has items." });
    expect(within(dialog).getByText("Please select how you want to proceed:")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Replace existing job items" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Add to existing job items" })).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(body).toEqual({ mode: "replace" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.deals.products("d1") }));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dealTotals("d1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.deals.detail("d1") });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/replaced.*1 item/i));
  });

  it("Add to existing job items appends the estimate's lines", async () => {
    let body: unknown;
    server.use(
      http.post("*/billing/estimates/e1/sync-to-job", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { estimate: { ...estimate, status: "won" }, itemCount: 4 } });
      }),
    );
    renderWithClient(<Editor />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /sync to job/i }));
    const dialog = await screen.findByRole("dialog", { name: "This job already has items." });
    await u.click(within(dialog).getByRole("radio", { name: "Add to existing job items" }));
    await u.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(body).toEqual({ mode: "append" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/added to the job/i)));
  });

  it("a job with no items yet takes the estimate's at once, without asking", async () => {
    mocks.products = [];
    let body: unknown;
    server.use(
      http.post("*/billing/estimates/e1/sync-to-job", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { estimate: { ...estimate, status: "won" }, itemCount: 1 } });
      }),
    );
    renderWithClient(<Editor />);
    await user().click(await screen.findByRole("button", { name: /sync to job/i }));
    await waitFor(() => expect(body).toEqual({ mode: "replace" }));
    expect(screen.queryByRole("dialog", { name: "This job already has items." })).not.toBeInTheDocument();
    mocks.products = [{ productId: "a" }, { productId: "b" }, { productId: "c" }];
  });

  it("offers Send only to someone who may send both estimates and messages", async () => {
    const { unmount } = renderWithClient(<Editor />);
    await screen.findByRole("button", { name: /sync to job/i });
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    unmount();

    mocks.perms.add("messages.send");
    renderWithClient(<Editor />);
    expect(await screen.findByRole("button", { name: /^send$/i })).toBeInTheDocument();
  });

  it("texts the client their portal link, marking the estimate sent first", async () => {
    mocks.perms.add("messages.send");
    const order: string[] = [];
    let sms: Record<string, unknown> | undefined;
    server.use(
      http.get("*/crm/contacts/c1", () =>
        HttpResponse.json({
          success: true,
          data: { id: "c1", firstName: "Jane", lastName: "Client", phones: ["+18605550199"], emails: [], addresses: [] },
        }),
      ),
      http.get("*/billing/business-profiles", () => HttpResponse.json({ success: true, data: [{ id: "bp1", name: "Sure Lock Key", isDefault: true }] })),
      http.get("*/billing/document-settings", () => HttpResponse.json({ success: true, data: {} })),
      http.post("*/billing/portal-links/c1/url", () =>
        HttpResponse.json({
          success: true,
          data: { contactId: "c1", createdBy: "u", createdAt: "t", url: "https://portal.test/tok_abc", token: "tok_abc" },
        }),
      ),
      http.post("*/billing/estimates/e1/mark-sent", () => {
        order.push("mark-sent");
        return HttpResponse.json({ success: true, data: { ...estimate, sentAt: "2026-09-16T11:00:00.000Z" } });
      }),
      http.post("*/messaging/messages", async ({ request }) => {
        order.push("sms");
        sms = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: { id: "m1", status: "queued" } }, { status: 202 });
      }),
    );
    renderWithClient(<Editor />);
    await user().click(await screen.findByRole("button", { name: /^send$/i }));

    const box = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain("https://portal.test/tok_abc"));
    expect(box.value).toContain("Hi Jane,");
    expect(box.value).toContain("Sure Lock Key");
    expect(box.value).toContain("#1042-1");

    await user().click(screen.getByRole("button", { name: /^send text$/i }));
    await waitFor(() => expect(sms).toBeDefined());
    expect(order).toEqual(["mark-sent", "sms"]);
    expect(sms).toMatchObject({ contactId: "c1", channel: "sms", dealId: "d1", body: expect.stringContaining("tok_abc") });
  });

  it("Send opens the Workiz-style panel with both Send email and Send text", async () => {
    mocks.perms.add("messages.send");
    server.use(
      http.get("*/crm/contacts/c1", () =>
        HttpResponse.json({ success: true, data: { id: "c1", firstName: "Jane", lastName: "Client", phones: [], emails: [], addresses: [] } }),
      ),
      http.get("*/billing/business-profiles", () => HttpResponse.json({ success: true, data: [] })),
      http.get("*/billing/document-settings", () => HttpResponse.json({ success: true, data: {} })),
      http.post("*/billing/portal-links/c1/url", () =>
        HttpResponse.json({ success: true, data: { contactId: "c1", createdBy: "u", createdAt: "t", url: "https://portal.test/tok", token: "tok" } }),
      ),
    );
    renderWithClient(<Editor />);
    await user().click(await screen.findByRole("button", { name: /^send$/i }));
    expect(await screen.findByRole("heading", { name: /send estimate #1042-1/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^send email$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^send text$/i })).toBeInTheDocument();
  });

  it("disables sync without the sync permission", async () => {
    mocks.perms.delete("estimates.sync");
    renderWithClient(<Editor />);
    const btn = await screen.findByRole("button", { name: /sync to job/i });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await user().click(btn);
    expect(screen.queryByText(/replaces the job's/i)).not.toBeInTheDocument();
  });

  it("disables sync for an estimate without items", async () => {
    server.use(
      http.get("*/billing/estimates/e1", () => HttpResponse.json({ success: true, data: { ...estimate, items: [] } })),
    );
    renderWithClient(<Editor />);
    expect(await screen.findByText(/no items on this estimate yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync to job/i })).toHaveAttribute("aria-disabled", "true");
  });

  it("toggles an item's taxable flag", async () => {
    let body: unknown;
    server.use(
      http.patch("*/billing/estimates/e1/items/l1/taxable", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...estimate.items[0], taxable: false } });
      }),
    );
    renderWithClient(<Editor />);
    await user().click(await screen.findByRole("checkbox", { name: /deadbolt is taxable/i }));
    await waitFor(() => expect(body).toEqual({ taxable: false }));
  });
});
