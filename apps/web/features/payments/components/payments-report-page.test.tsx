import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { PaymentReportRow } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { viewerToday } from "@/features/reports/jobs/lib";

const mocks = vi.hoisted(() => ({ canView: true, money: true, toast: { warning: vi.fn(), error: vi.fn() } }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  // This suite asserts the refusal, so `useDenied` mirrors its own `can`.
  useDenied: () => () => !mocks.canView,
  usePermissions: () => ({ can: (r: string) => (r === "financials" ? mocks.money : mocks.canView), isLoading: false }),
}));
vi.mock("@/features/deals/hooks", () => {
  const tom = { id: "t1", firstName: "Tom", lastName: "Tech", workizName: "(2) TX - Tom Tech" };
  return { useUserMap: () => ({ map: new Map([["t1", tom]]), users: [tom], isLoading: false }) };
});
vi.mock("@/features/technicians/hooks", () => ({
  useAllTechnicians: () => ({ profiles: [{ userId: "t1", createdAt: "2020-01-01T00:00:00.000Z" }], isLoading: false }),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useServiceAreas: () => ({ data: [{ id: "a1", name: "North Carolina", active: true, color: "#e0103a" }] }),
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
  description: "Approved",
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
  mocks.money = true;
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
    http.post("*/crm/contacts/by-ids", () =>
      HttpResponse.json({ success: true, data: [{ id: "c1", firstName: "Jane", lastName: "Doe", phones: ["4695000793"], emails: [] }] }),
    ),
  );
});

const box = () => screen.getByRole("button", { name: /^Date range:/ });
const lineOf = (job: string) => screen.getByRole("link", { name: `${job} (Job)` }).closest("tr")!;

describe("PaymentsReportPage", () => {
  it("refuses anyone without payments.view", () => {
    mocks.canView = false;
    renderWithClient(<PaymentsReportPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("opens on This month to today, newest first, 10 a page — Workiz's defaults", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)");
    const today = viewerToday();
    const first = calls[0];
    expect(first.get("from")).toBe(`${today.slice(0, 7)}-01`);
    expect(first.get("to")).toBe(today);
    expect(first.get("dir")).toBe("desc");
    expect(first.get("limit")).toBe("10");
    expect(box()).toHaveTextContent("This month");
    expect(screen.getByRole("heading", { name: "Payments report" })).toBeInTheDocument();
  });

  it("shows the two cards and the lines as Workiz prints them", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)");
    expect(within(screen.getByRole("group", { name: "Total amount" })).getByText("$687,302.60")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Total tips" })).getByText("$2,980.70")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(14);

    const charge = lineOf("6563K8");
    expect(within(charge).getByText("$1,064.44")).toBeInTheDocument();
    expect(within(charge).getByText("Succeeded")).toBeInTheDocument();
    expect(within(charge).getByText("Sat, Sep 12, 2026")).toBeInTheDocument();
    expect(within(charge).getByRole("link", { name: "Jane Doe" })).toHaveAttribute("href", "/contacts/c1");
    // The tech by their Workiz name, the client's phone under the name.
    expect(within(charge).getByRole("link", { name: "(2) TX - Tom Tech" })).toHaveAttribute("href", "/technicians/t1");
    expect(await within(charge).findByRole("link", { name: "(469) 500-0793" })).toBeInTheDocument();
    // A refund is its own line, in parentheses.
    expect(within(lineOf("R7KQ2P")).getByText("($85.74)")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 2 of 3 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("without financials.view shows the lines but no money: no cards, no Amount, no Tip", async () => {
    mocks.money = false;
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)");
    expect(screen.queryByRole("group", { name: "Total amount" })).toBeNull();
    expect(screen.queryByText("$1,064.44")).toBeNull();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Amount");
  });

  it("walks to the next page with the server's cursor, and back", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)");
    await user().click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("AF6A0K (Job)");
    expect(calls.at(-1)?.get("cursor")).toBe("page2");
    expect(screen.getByText("Showing 3 to 3 of 3 results")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("6563K8 (Job)")).toBeInTheDocument();
  });

  it("sends the picks of Filter results, shown as Workiz's chips", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)");
    const filter = screen.getByRole("combobox", { name: "Filter results" });
    await user().click(filter);
    await user().click(screen.getByRole("option", { name: "Refund" }));
    await user().click(filter);
    await user().click(screen.getByRole("option", { name: "North Carolina" }));
    await user().click(filter);
    await user().click(screen.getByRole("option", { name: "(2) TX - Tom Tech" }));
    await waitFor(() => {
      const last = calls.at(-1)!;
      expect(last.get("types")).toBe("refund");
      expect(last.get("serviceAreaIds")).toBe("a1");
      expect(last.get("technicianIds")).toBe("t1");
    });
    expect(screen.getByText("Refund", { selector: "[data-slot=wz-filter-chip] span" })).toBeInTheDocument();
    expect(screen.getByText("metro: North Carolina")).toBeInTheDocument();
    expect(screen.getByText("technician: (2) TX - Tom Tech")).toBeInTheDocument();
  });

  it("asks for every day there is on All time, and for last month on Last month", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)");
    await user().click(box());
    await user().click(screen.getByRole("option", { name: "All time" }));
    await waitFor(() => {
      const last = calls.at(-1)!;
      expect(last.get("from")).toBeNull();
      expect(last.get("to")).toBeNull();
    });
    expect(box()).toHaveTextContent("All timeAll time");

    await user().click(box());
    await user().click(screen.getByRole("option", { name: "Last month" }));
    await waitFor(() => expect(calls.at(-1)!.get("to")).toMatch(/-(28|29|30|31)$/));
  });

  it("sorts by payment date both ways", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)");
    await user().click(screen.getByRole("button", { name: "Sort by Payment date" }));
    await waitFor(() => expect(calls.at(-1)?.get("dir")).toBe("asc"));
  });

  it("a Custom range over 12 months is refused before asking the server", async () => {
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)");
    await user().click(box());
    await user().click(screen.getByRole("option", { name: "Custom" }));
    const before = calls.length;
    const from = screen.getByRole("textbox", { name: "From" });
    await user().clear(from);
    await user().type(from, "01/01/2024{Enter}");
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
    await screen.findByText("6563K8 (Job)");
    await user().click(screen.getByRole("button", { name: /Export/ }));
    await waitFor(() => expect(exported).toBeDefined());
    expect(exported!.get("limit")).toBeNull();
    expect(exported!.get("from")).toMatch(/-01$/);
  });
});
