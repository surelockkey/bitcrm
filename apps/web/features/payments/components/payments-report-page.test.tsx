import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { PaymentReportRow } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ canView: true, toast: { warning: vi.fn(), error: vi.fn() } }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => mocks.canView }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({ map: new Map([["t1", { id: "t1", firstName: "Tom", lastName: "Tech" }]]) }),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useServiceAreas: () => ({ data: [{ id: "a1", name: "North Carolina", active: true }] }),
}));

import { PaymentsReportPage } from "./payments-report-page";

const row = (over: Partial<PaymentReportRow> = {}): PaymentReportRow => ({
  id: "p1",
  kind: "payment",
  paymentId: "p1",
  dealId: "d1",
  dealNumber: "6563K8",
  at: "2026-09-12T16:00:00.000Z",
  amount: 1064.44,
  tip: 134.8,
  type: "charge",
  typeLabel: "Credit charge",
  status: "succeeded",
  description: "Transaction was approved",
  contactId: "c1",
  clientName: "Jane Doe",
  card: "XXXX4242",
  technicianId: "t1",
  technicianName: "Tom Tech",
  transactionMethod: "Card reader",
  collectedByName: "Kate Office",
  jobTypeName: "Lockout",
  ...over,
});

const calls: URLSearchParams[] = [];
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  mocks.canView = true;
  calls.length = 0;
  server.use(
    http.get("*/billing/payments/report", ({ request }) => {
      const params = new URL(request.url).searchParams;
      calls.push(params);
      if (params.get("cursor") === "page2") {
        return HttpResponse.json({ success: true, data: { items: [row({ id: "p9", dealNumber: "AF6A0K", amount: 230, tip: 0, type: "cash", typeLabel: "Cash", status: undefined })] } });
      }
      return HttpResponse.json({
        success: true,
        data: {
          items: [
            row({ id: "r1", kind: "refund", dealId: "d7", dealNumber: "R7KQ2P", amount: -85.74, tip: 0, type: "refund", typeLabel: "Refund", card: undefined, description: undefined }),
            row(),
          ],
          nextCursor: "page2",
          totals: { count: 3, amount: 687302.6, tips: 2980.7, serviceFees: 0, byType: {} },
        },
      });
    }),
  );
});

describe("PaymentsReportPage", () => {
  it("refuses anyone without payments.view", () => {
    mocks.canView = false;
    renderWithClient(<PaymentsReportPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("opens on This month, newest first, 10 a page — Workiz's defaults", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8");
    const first = calls[0];
    expect(first.get("dir")).toBe("desc");
    expect(first.get("limit")).toBe("10");
    expect(first.get("from")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(screen.getByLabelText("Date range")).toHaveValue("this_month");
  });

  it("shows the two cards and Workiz's 14 columns", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8");
    expect(screen.getByText("$687,302.60")).toBeInTheDocument();
    expect(screen.getByText("$2,980.70")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "ID",
      "Amount",
      "Payment date",
      "Status",
      "Type",
      "Confirmation code",
      "Description",
      "Client",
      "Tip",
      "Card",
      "Technician",
      "Transaction method",
      "Collected by",
      "Job Type",
    ]);
    const charge = screen.getByText("6563K8").closest("tr")!;
    expect(within(charge).getByText("$1,064.44")).toBeInTheDocument();
    expect(within(charge).getByText("Succeeded")).toBeInTheDocument();
    expect(within(charge).getByRole("link", { name: "Jane Doe" })).toHaveAttribute("href", "/contacts/c1");
    expect(within(charge).getByRole("link", { name: "6563K8" })).toHaveAttribute("href", "/deals/d1");
    // A refund is its own line, in parentheses.
    expect(screen.getByText("($85.74)")).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 to 2 of 3 results/)).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("walks to the next page with the server's cursor, and back", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8");
    await user().click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("AF6A0K");
    expect(calls.at(-1)?.get("cursor")).toBe("page2");
    expect(screen.getByText(/Showing 3 to 3 of 3 results/)).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("6563K8")).toBeInTheDocument();
  });

  it("sends the chosen filter groups and the date preset", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8");
    await user().click(screen.getByRole("button", { name: "Filter results" }));
    await user().click(await screen.findByText("Refund", { selector: "[cmdk-item], [cmdk-item] *" }));
    await user().click(await screen.findByText("North Carolina"));
    await user().click(await screen.findByText("Tom Tech", { selector: "[cmdk-item], [cmdk-item] *" }));
    await waitFor(() => {
      const last = calls.at(-1)!;
      expect(last.get("types")).toBe("refund");
      expect(last.get("serviceAreaIds")).toBe("a1");
      expect(last.get("technicianIds")).toBe("t1");
    });

    await user().keyboard("{Escape}");
    await user().selectOptions(screen.getByLabelText("Date range"), "all_time");
    await waitFor(() => {
      const last = calls.at(-1)!;
      expect(last.get("from")).toBeNull();
      expect(last.get("to")).toBeNull();
    });
  });

  it("sorts by payment date both ways", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8");
    await user().click(screen.getByRole("button", { name: /Sort by payment date/ }));
    await waitFor(() => expect(calls.at(-1)?.get("dir")).toBe("asc"));
  });

  it("a Custom range over 12 months is refused before asking the server", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8");
    await user().selectOptions(screen.getByLabelText("Date range"), "custom");
    const before = calls.length;
    await user().type(screen.getByLabelText("From"), "2024-01-01");
    await user().type(screen.getByLabelText("To"), "2026-01-01");
    expect(await screen.findByRole("alert")).toHaveTextContent(/12 months/);
    expect(calls.length).toBe(before);
  });

  it("exports Workiz's CSV from the server", async () => {
    let exported: URLSearchParams | undefined;
    server.use(
      http.get("*/billing/payments/report/export", ({ request }) => {
        exported = new URL(request.url).searchParams;
        return HttpResponse.json({
          success: true,
          data: { filename: "Payment report.csv", csv: "Job ID,Document\n", count: 0, truncated: false },
        });
      }),
    );
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8");
    await user().click(screen.getByRole("button", { name: /Export/ }));
    await waitFor(() => expect(exported).toBeDefined());
    expect(exported!.get("limit")).toBeNull();
    expect(exported!.get("from")).toMatch(/-01$/);
  });
});
