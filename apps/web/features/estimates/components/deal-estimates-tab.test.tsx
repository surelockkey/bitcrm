import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Deal, EstimateWithItems } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { queryKeys } from "@/lib/query-keys";

const mocks = vi.hoisted(() => ({
  products: [{ productId: "a" }, { productId: "b" }, { productId: "c" }] as { productId: string }[],
  perms: new Set<string>(),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`) }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useDealProducts: () => ({ data: mocks.products, isLoading: false }),
}));
// The summary panel pulls the tax catalog; not under test here.
vi.mock("@/features/billing/components/document-summary-panel", () => ({
  DocumentSummaryPanel: ({ totals }: { totals: { total: number } }) => <div data-testid="summary">{totals.total}</div>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { DealEstimatesTab } from "./deal-estimates-tab";

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

function Harness({ initial = null }: { initial?: string | null }) {
  const [id, setId] = useState<string | null>(initial);
  return <DealEstimatesTab deal={deal} estimateId={id} onEstimateChange={setId} />;
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const ALL = ["view", "create", "edit", "delete", "send", "sync"].map((a) => `estimates.${a}`);

beforeEach(() => {
  mocks.perms = new Set(ALL);
  server.use(
    http.get("*/billing/templates", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/billing/estimates/by-deal/d1", () => HttpResponse.json({ success: true, data: [estimate] })),
    http.get("*/billing/estimates/e1", () => HttpResponse.json({ success: true, data: estimate })),
  );
});

describe("DealEstimatesTab", () => {
  it("lists estimate cards and opens one in the editor", async () => {
    renderWithClient(<Harness />);
    const card = await screen.findByRole("button", { name: /#1042-1/ });
    expect(card).toHaveTextContent("Good");
    expect(card).toHaveTextContent("Pending");
    expect(card).toHaveTextContent("1 item");
    expect(card).toHaveTextContent("$80.00");
    await user().click(card);
    expect(await screen.findByRole("heading", { name: "Estimate #1042-1 · Good" })).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: /all estimates/i }));
    expect(await screen.findByRole("button", { name: /#1042-1/ })).toBeInTheDocument();
  });

  it("creates an estimate copying the job items and opens it", async () => {
    let body: unknown;
    server.use(
      http.post("*/billing/estimates", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...estimate, id: "e2", number: "1042-2", name: "Better" } });
      }),
      http.get("*/billing/estimates/e2", () =>
        HttpResponse.json({ success: true, data: { ...estimate, id: "e2", number: "1042-2", name: "Better" } }),
      ),
    );
    renderWithClient(<Harness />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /new estimate/i }));
    await u.type(screen.getByLabelText(/^name/i), "Better");
    expect(screen.getByRole("checkbox", { name: /copy current job items/i })).toBeChecked();
    await u.click(screen.getByRole("button", { name: /create estimate/i }));
    await waitFor(() => expect(body).toEqual({ dealId: "d1", name: "Better", copyJobItems: true }));
    expect(await screen.findByRole("heading", { name: "Estimate #1042-2 · Better" })).toBeInTheDocument();
  });

  it("hides New estimate without create permission", async () => {
    mocks.perms.delete("estimates.create");
    renderWithClient(<Harness />);
    await screen.findByRole("button", { name: /#1042-1/ });
    expect(screen.queryByRole("button", { name: /new estimate/i })).not.toBeInTheDocument();
  });
});

describe("EstimateEditor — sync to job", () => {
  it("confirms with item counts, syncs and refreshes the job", async () => {
    let synced = false;
    server.use(
      http.post("*/billing/estimates/e1/sync-to-job", () => {
        synced = true;
        return HttpResponse.json({ success: true, data: { estimate: { ...estimate, status: "won" }, itemCount: 1 } });
      }),
    );
    const { client } = renderWithClient(<Harness initial="e1" />);
    const spy = vi.spyOn(client, "invalidateQueries");
    const u = user();
    await u.click(await screen.findByRole("button", { name: /sync to job/i }));
    expect(
      await screen.findByText(/replaces the job's 3 current items with the estimate's 1 item/i),
    ).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /replace job items/i }));
    await waitFor(() => expect(synced).toBe(true));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.deals.products("d1") }),
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.dealTotals("d1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.deals.detail("d1") });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/1 item synced/));
  });

  it("offers Send by text only to someone who may send both estimates and messages", async () => {
    const { unmount } = renderWithClient(<Harness initial="e1" />);
    await screen.findByRole("button", { name: /sync to job/i });
    expect(screen.queryByRole("button", { name: /send by text/i })).not.toBeInTheDocument();
    unmount();

    mocks.perms.add("messages.send");
    renderWithClient(<Harness initial="e1" />);
    expect(await screen.findByRole("button", { name: /send by text/i })).toBeInTheDocument();
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
      http.get("*/billing/business-profiles", () => HttpResponse.json({ success: true, data: [] })),
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
    renderWithClient(<Harness initial="e1" />);
    await user().click(await screen.findByRole("button", { name: /send by text/i }));

    const box = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain("https://portal.test/tok_abc"));
    expect(box.value).toBe("Hi Jane, your estimate #1042-1 is ready ($80.00). View it here: https://portal.test/tok_abc");

    await user().click(screen.getByRole("button", { name: /send text/i }));
    await waitFor(() => expect(sms).toBeDefined());
    expect(order).toEqual(["mark-sent", "sms"]);
    expect(sms).toMatchObject({ contactId: "c1", channel: "sms", dealId: "d1", body: expect.stringContaining("tok_abc") });
  });

  it("disables sync without the sync permission", async () => {
    mocks.perms.delete("estimates.sync");
    renderWithClient(<Harness initial="e1" />);
    const btn = await screen.findByRole("button", { name: /sync to job/i });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await user().click(btn);
    expect(screen.queryByText(/replaces the job's/i)).not.toBeInTheDocument();
  });

  it("disables sync for an estimate without items", async () => {
    server.use(
      http.get("*/billing/estimates/e1", () => HttpResponse.json({ success: true, data: { ...estimate, items: [] } })),
    );
    renderWithClient(<Harness initial="e1" />);
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
    renderWithClient(<Harness initial="e1" />);
    await user().click(await screen.findByRole("checkbox", { name: /deadbolt is taxable/i }));
    await waitFor(() => expect(body).toEqual({ taxable: false }));
  });
});
