import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), canInvoices: true, asked: 0 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, prefetch: vi.fn() }),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string) => r !== "invoices" || mocks.canInvoices, isLoading: false }),
}));

import { LegacyInvoiceTabRedirect } from "./legacy-invoice-tab-redirect";

beforeEach(() => {
  mocks.replace.mockClear();
  mocks.canInvoices = true;
  mocks.asked = 0;
});

const answer = (data: unknown) =>
  server.use(
    http.get("*/billing/invoices/by-deal/d1", () => {
      mocks.asked += 1;
      return HttpResponse.json({ success: true, data });
    }),
  );

/**
 * `/deals/<id>?tab=invoice` — the job page's old Invoice tab, still in texts,
 * bookmarks and history — goes where the invoice lives now.
 */
describe("LegacyInvoiceTabRedirect", () => {
  it("opens the job's invoice on its own page", async () => {
    answer({ id: "d1", dealId: "d1", number: "1042" });
    const { container } = renderWithClient(<LegacyInvoiceTabRedirect dealId="d1" />);
    // One skeleton while it finds out.
    expect(container.querySelector("[data-slot=skeleton]")).not.toBeNull();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/invoices/d1"));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
  });

  it("lands on the job while it has no invoice", async () => {
    answer(null);
    renderWithClient(<LegacyInvoiceTabRedirect dealId="d1" />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/deals/d1"));
  });

  it("lands on the job for someone who may not see invoices, without asking for one", async () => {
    mocks.canInvoices = false;
    answer({ id: "d1", dealId: "d1", number: "1042" });
    renderWithClient(<LegacyInvoiceTabRedirect dealId="d1" />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/deals/d1"));
    expect(mocks.asked).toBe(0);
  });

  it("lands on the job when the invoice cannot be read", async () => {
    server.use(http.get("*/billing/invoices/by-deal/d1", () => HttpResponse.json({ success: false }, { status: 500 })));
    renderWithClient(<LegacyInvoiceTabRedirect dealId="d1" />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/deals/d1"), { timeout: 4000 });
  });
});
