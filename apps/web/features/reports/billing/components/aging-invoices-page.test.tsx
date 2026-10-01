import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ canView: true }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => !mocks.canView,
  usePermissions: () => ({ can: () => mocks.canView }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AgingInvoicesPage } from "./aging-invoices-page";

const calls: URLSearchParams[] = [];
const cards = {
  all: { count: 547, amount: 518897.29 },
  under30: { count: 24, amount: 16518.19 },
  from30to60: { count: 23, amount: 13192.53 },
  from60to90: { count: 15, amount: 15363.76 },
  over90: { count: 233, amount: 101034.69 },
};

beforeEach(() => {
  mocks.canView = true;
  calls.length = 0;
  server.use(
    http.get("*/billing/invoices/aging", ({ request }) => {
      const p = new URL(request.url).searchParams;
      calls.push(p);
      return HttpResponse.json({
        success: true,
        data: {
          asOf: "2026-09-29",
          bucket: p.get("bucket") ?? "all",
          cards,
          items: [
            {
              invoiceId: "d1", dealId: "d1", number: "1MHIJW", contactId: "c1", clientName: "Bryan Creevy",
              clientEmail: "245110@carmax.com", total: 120, balance: 120, dueDate: "2019-07-16",
              createdAt: "2019-07-16T15:00:00.000Z", daysLate: 2632,
            },
          ],
          total: 547,
          page: Number(p.get("page") ?? 1),
          pageSize: Number(p.get("pageSize") ?? 10),
          indexReady: true,
        },
      });
    }),
  );
});

describe("AgingInvoicesPage", () => {
  it("shows Workiz's five cards and the oldest debt first", async () => {
    renderWithClient(<AgingInvoicesPage />);
    expect(await screen.findByRole("button", { name: /\$518,897\.29 547 invoices due/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\$101,034\.69 over 90 days \(233\)/ })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /1MHIJW/ });
    expect(within(row).getByText("2632")).toBeInTheDocument();
    expect(within(row).getByText("245110@carmax.com")).toBeInTheDocument();
    // Due on and Created — the same day on this one.
    expect(within(row).getAllByText("Tue Jul 16, 2019")).toHaveLength(2);
    expect(screen.getByText(/Showing 1 to 1 of 547 results/)).toBeInTheDocument();
    expect(calls[0].get("sort")).toBe("daysLate");
    expect(calls[0].get("dir")).toBe("desc");
  });

  it("filters by a card and sorts by a column on the server", async () => {
    renderWithClient(<AgingInvoicesPage />);
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    await u.click(await screen.findByRole("button", { name: /30-60 days/ }));
    await waitFor(() => expect(calls.some((p) => p.get("bucket") === "from30to60")).toBe(true));
    await u.click(screen.getByRole("button", { name: "Balance" }));
    await waitFor(() => expect(calls.some((p) => p.get("sort") === "balance" && p.get("dir") === "desc")).toBe(true));
  });

  it("refuses without invoices.view", () => {
    mocks.canView = false;
    renderWithClient(<AgingInvoicesPage />);
    expect(screen.getByText(/don't have permission to view invoices/i)).toBeInTheDocument();
  });
});
