import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Payment } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ canView: true }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => mocks.canView }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useContactMap: () => ({
    map: new Map([["c1", { firstName: "Jane", lastName: "Smith" }]]),
    isLoading: false,
  }),
}));

import { PaymentsPage } from "./payments-page";

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: "p1", invoiceId: "d1", dealId: "d1", contactId: "c1",
  amount: 150, currency: "usd", method: "card", status: "settled", refundedAmount: 0,
  source: "portal", takenBy: "client", takenAt: "2026-09-20T15:00:00.000Z",
  version: 1, createdAt: "2026-09-20T15:00:00.000Z", updatedAt: "2026-09-20T15:00:00.000Z",
  ...over,
});

const listCalls: URLSearchParams[] = [];
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function list(over: { empty?: boolean; status?: number } = {}) {
  server.use(
    http.get("*/billing/payments", ({ request }) => {
      const params = new URL(request.url).searchParams;
      listCalls.push(params);
      if (over.status && over.status >= 400) {
        return HttpResponse.json({ success: false, message: "Report unavailable" }, { status: over.status });
      }
      if (over.empty) {
        return HttpResponse.json({
          success: true,
          data: { items: [], summary: { settled: 0, pending: 0, refunded: 0, paymentCount: 0, hasPending: false } },
        });
      }
      if (params.get("cursor") === "next") {
        return HttpResponse.json({
          success: true,
          data: { items: [payment({ id: "p2", dealId: "d2", amount: 60, method: "cash" })] },
        });
      }
      return HttpResponse.json({
        success: true,
        data: {
          items: [payment({ reference: "ch_123" })],
          nextCursor: "next",
          summary: { settled: 900, pending: 120, refunded: 45, paymentCount: 7, hasPending: true },
        },
      });
    }),
  );
}

beforeEach(() => {
  mocks.canView = true;
  listCalls.length = 0;
  list();
});

describe("PaymentsPage", () => {
  it("refuses anyone without payments.view", () => {
    mocks.canView = false;
    renderWithClient(<PaymentsPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("totals what the filters cover: collected, clearing and refunded", async () => {
    renderWithClient(<PaymentsPage />);
    expect(await screen.findByText("$900.00")).toBeInTheDocument();
    expect(screen.getByText("$120.00")).toBeInTheDocument();
    expect(screen.getByText("$45.00")).toBeInTheDocument();
  });

  it("lists a payment with its client, method, amount and a way back to the job", async () => {
    renderWithClient(<PaymentsPage />);
    const row = (await screen.findByText("ch_123")).closest("tr")!;
    expect(row).toHaveTextContent("Jane Smith");
    expect(row).toHaveTextContent("Card");
    expect(row).toHaveTextContent("$150.00");
    expect(within(row).getByRole("link", { name: /job/i })).toHaveAttribute("href", "/deals/d1");
  });

  it("passes the method and status filters to the API", async () => {
    const u = user();
    renderWithClient(<PaymentsPage />);
    await screen.findByText("ch_123");

    await u.click(screen.getByLabelText("Method"));
    await u.click(await screen.findByRole("option", { name: "Bank" }));
    await waitFor(() => expect(listCalls.at(-1)!.get("method")).toBe("bank"));

    await u.click(screen.getByLabelText("Status"));
    await u.click(await screen.findByRole("option", { name: "Clearing" }));
    await waitFor(() => expect(listCalls.at(-1)!.get("status")).toBe("pending"));
    expect(listCalls.at(-1)!.get("method")).toBe("bank");
  });

  it("passes the date range to the API", async () => {
    const u = user();
    renderWithClient(<PaymentsPage />);
    await screen.findByText("ch_123");
    await u.type(screen.getByLabelText("From"), "2026-09-01");
    await waitFor(() => expect(listCalls.at(-1)!.get("from")).toBe("2026-09-01"));
  });

  it("pages with the cursor", async () => {
    const u = user();
    renderWithClient(<PaymentsPage />);
    await u.click(await screen.findByRole("button", { name: /load more/i }));
    await waitFor(() => expect(listCalls.at(-1)!.get("cursor")).toBe("next"));
    expect(await screen.findByText("$60.00")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    list({ empty: true });
    renderWithClient(<PaymentsPage />);
    expect(await screen.findByText(/no payments match these filters/i)).toBeInTheDocument();
  });

  it("offers a retry when the report can't be loaded", async () => {
    list({ status: 500 });
    renderWithClient(<PaymentsPage />);
    expect(await screen.findByText("Report unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
