import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Estimate } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("@/features/clients/hooks", () => ({
  useContactsByIds: () => ({
    map: new Map([["c1", { firstName: "Jane", lastName: "Smith" }]]),
    isLoading: false,
  }),
}));

import { EstimatesPage } from "./estimates-page";

const totals = {
  lineCount: 1, subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 100, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100,
};
const est = (over: Partial<Estimate>): Estimate => ({
  id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042", contactId: "c1",
  name: "Front door rekey", status: "pending", estimateDate: "2026-09-16", totals,
  version: 1, createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "",
  ...over,
} as Estimate);

beforeEach(() => {
  server.use(
    http.get("*/billing/estimates/summary", () => HttpResponse.json({ success: true, data: {} })),
    http.get("*/billing/estimates/count", () =>
      HttpResponse.json({ success: true, data: { total: 1 } }),
    ),
    http.get("*/billing/estimates", () =>
      HttpResponse.json({ success: true, data: { items: [est({})] } }),
    ),
  );
});

/**
 * Ширину колонок можна тягнути, і вона запам'ятовується.
 *
 * Клієнта називає окремий запит, тож за авто-розкладки сітка переміряла б
 * себе, коли ім'я доїде. Ширину задає лише colgroup — клітинка, що поставила
 * б свою, перемогла б її й розсунула сусідів.
 */
describe("EstimatesPage — resizable columns", () => {
  it("lays the estimate list out at declared widths, not by content", async () => {
    const { container } = renderWithClient(<EstimatesPage />);
    await screen.findByText("#1042-1");
    const table = container.querySelector("table") as HTMLTableElement;
    expect(table.className).toContain("table-fixed");
    const cols = [...table.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(table.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
    for (const cell of table.querySelectorAll("tbody td")) {
      expect(cell.className).not.toMatch(/\b(min-w|max-w|w)-/);
    }
  });

  it("puts a drag handle on every estimate column", async () => {
    renderWithClient(<EstimatesPage />);
    await screen.findByText("#1042-1");
    for (const id of ["number", "name", "client", "created", "total", "status", "job"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
