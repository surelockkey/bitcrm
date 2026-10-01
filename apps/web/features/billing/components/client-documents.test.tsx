import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { PaymentTerms } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { ClientEstimatesList, ClientInvoicesList } from "./client-documents";

const totals = {
  lineCount: 1, subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 100, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100,
};
const base = { contactId: "c1", totals, version: 1, createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "" };

beforeEach(() => {
  server.use(
    http.get("*/billing/estimates", () =>
      HttpResponse.json({
        success: true,
        data: {
          items: [
            { ...base, id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042", status: "pending", estimateDate: "2026-09-16" },
            { ...base, id: "e9", number: "1141", status: "unsent", estimateDate: "2026-09-17" },
          ],
        },
      }),
    ),
    http.get("*/billing/invoices", () =>
      HttpResponse.json({
        success: true,
        data: {
          items: [
            { ...base, id: "d1", number: "1042", dealId: "d1", invoiceDate: "2026-09-16", paymentTerms: PaymentTerms.CASH, dueDate: "2026-09-16", status: "due" },
            { ...base, id: "inv-9", number: "1001", invoiceDate: "2026-09-17", paymentTerms: PaymentTerms.NET_30, dueDate: "2026-10-17", status: "due" },
          ],
        },
      }),
    ),
  );
});

/**
 * Workiz: a client's documents live either on a job or on the client alone.
 * A job's invoice opens in the job's tab; every estimate has its own page.
 */
describe("client document lists", () => {
  it("opens every estimate on its own page — a job's one leads back to its job from there (Workiz)", async () => {
    renderWithClient(<ClientEstimatesList contactIds={["c1"]} />);
    expect(await screen.findByRole("link", { name: /#1042-1/ })).toHaveAttribute("href", "/estimates/e1");
    expect(screen.getByRole("link", { name: /#1141/ })).toHaveAttribute("href", "/estimates/e9");
  });

  it("links a job's invoice to the job tab and a client invoice to its own page", async () => {
    renderWithClient(<ClientInvoicesList contactIds={["c1"]} />);
    expect(await screen.findByRole("link", { name: /#1042/ })).toHaveAttribute("href", "/deals/d1?tab=invoice");
    expect(screen.getByRole("link", { name: /#1001/ })).toHaveAttribute("href", "/invoices/inv-9");
  });
});
