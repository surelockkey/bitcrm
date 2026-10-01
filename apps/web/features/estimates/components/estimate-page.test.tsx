import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { EstimateWithItems } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
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
  useDealProducts: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({ data: { id: "c1", firstName: "Jane", lastName: "Client", phones: [], emails: [], addresses: [] } }),
}));
vi.mock("@/features/billing/components/document-summary-panel", () => ({
  DocumentSummaryPanel: ({ totals }: { totals: { total: number } }) => <div data-testid="summary">{totals.total}</div>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

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
  server.use(http.get("*/billing/templates", () => HttpResponse.json({ success: true, data: [] })));
});

/** Workiz: a client's estimate (no job) opens on its own page, straight from the client card. */
describe("StandaloneEstimatePage", () => {
  it("opens the editor for a client estimate with the client named and no job to sync to", async () => {
    server.use(http.get("*/billing/estimates/e9", () => HttpResponse.json({ success: true, data: estimate() })));
    renderWithClient(<StandaloneEstimatePage estimateId="e9" />);
    expect(await screen.findByRole("heading", { name: "Estimate #1141" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Jane Client/ })).toHaveAttribute("href", "/contacts/c1");
    // A tab's "All estimates" back link has no place on a page of its own.
    expect(screen.queryByRole("button", { name: /all estimates/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync to job/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("No items on this estimate yet.")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("sends a job's estimate to the job's Estimates tab", async () => {
    server.use(
      http.get("*/billing/estimates/e1", () =>
        HttpResponse.json({ success: true, data: estimate({ id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042" }) }),
      ),
    );
    renderWithClient(<StandaloneEstimatePage estimateId="e1" />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/deals/d1?tab=estimates&estimate=e1"));
  });
});
