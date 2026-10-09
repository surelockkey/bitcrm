import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { AgingRow } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ canView: true, money: true }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => !mocks.canView,
  usePermissions: () => ({
    can: (resource: string) => (resource === "financials" ? mocks.money : mocks.canView),
    isLoading: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AgingInvoicesPage } from "./aging-invoices-page";

const calls: URLSearchParams[] = [];
// Workiz, live 2026-10-09 (rep_aging_wz_01_default).
const cards = {
  all: { count: 564, amount: 490312.15 },
  under30: { count: 34, amount: 24508.45 },
  from30to60: { count: 25, amount: 10516.67 },
  from60to90: { count: 0, amount: 0 },
  over90: { count: 235, amount: 61496.28 },
};
const rows: AgingRow[] = [
  {
    invoiceId: "d1", dealId: "d1", number: "1MHIJW", contactId: "c1", clientName: "Bryan Creevy",
    clientEmail: "245110@carmax.com", clientPhone: "8605297621", total: 120, balance: 120, dueDate: "2019-07-16",
    createdAt: "2019-07-16T15:00:03.000Z", daysLate: 2642,
  },
  {
    invoiceId: "i2", number: "0PZ2O0", contactId: "c2", clientName: "Mr Terry", clientPhone: "2102691344",
    total: 430.71, balance: 111.68, dueDate: "2023-05-15", createdAt: "2023-05-15T21:14:08.000Z", daysLate: 1243,
  },
];

beforeEach(() => {
  mocks.canView = true;
  mocks.money = true;
  calls.length = 0;
  server.use(
    http.get("*/billing/invoices/aging", ({ request }) => {
      const p = new URL(request.url).searchParams;
      calls.push(p);
      const bucket = (p.get("bucket") ?? "all") as keyof typeof cards;
      return HttpResponse.json({
        success: true,
        data: {
          asOf: "2026-10-09",
          bucket,
          cards,
          items: bucket === "from60to90" ? [] : rows,
          total: cards[bucket].count,
          page: Number(p.get("page") ?? 1),
          pageSize: Number(p.get("pageSize") ?? 10),
          indexReady: true,
        },
      });
    }),
  );
});

const last = () => calls[calls.length - 1];

describe("AgingInvoicesPage — Workiz's Aging invoices", () => {
  it("opens on every unpaid invoice: five cards in Workiz's words, the rows in the server's order", async () => {
    renderWithClient(<AgingInvoicesPage />);
    const all = await screen.findByRole("button", { name: "$490,312.15 564 invoices due" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "$24,508.45 under 30 days (34)" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "$0.00 60-90 days (0)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$61,496.28 over 90 days (235)" })).toBeInTheDocument();
    // No title and no "As of" — Workiz has neither.
    expect(screen.queryByRole("heading", { name: /aging invoices/i })).toBeNull();
    expect(screen.queryByText(/^As of/)).toBeNull();

    // Workiz's eight columns; no sort until a header is clicked.
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Invoice No.", "Invoice Name", "Client name", "Total", "Balance", "Due on", "Created", "Days Late"]);
    expect(calls[0].get("sort")).toBeNull();
    expect(calls[0].get("dir")).toBeNull();
    expect(calls[0].get("bucket")).toBe("all");
    expect(calls[0].get("pageSize")).toBe("10");

    const row = screen.getByRole("row", { name: /1MHIJW/ });
    expect(within(row).getByRole("link", { name: "1MHIJW" })).toHaveAttribute("href", "/invoices/d1");
    expect(within(row).getByRole("link", { name: "Bryan Creevy" })).toHaveAttribute("href", "/contacts/c1");
    // The email under the name; the phone only when there is no email.
    expect(within(row).getByText("245110@carmax.com")).toBeInTheDocument();
    expect(within(row).queryByText("(860) 529-7621")).toBeNull();
    expect(within(row).getAllByText("$120.00")).toHaveLength(2);
    // Due on and Created — the same day here (11:00 am New York).
    expect(within(row).getAllByText("Tue Jul 16, 2019")).toHaveLength(2);
    expect(within(row).getByText("2642")).toBeInTheDocument();

    const terry = screen.getByRole("row", { name: /0PZ2O0/ });
    expect(within(terry).getByRole("link", { name: "0PZ2O0" })).toHaveAttribute("href", "/invoices/i2");
    expect(within(terry).getByRole("link", { name: "(210) 269-1344" })).toHaveAttribute("href", "tel:2102691344");

    expect(screen.getByText("Showing 1 to 2 of 564 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 57")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("10");
    expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
  });

  it("a header sorts on the server, ascending first; a card keeps the sort and goes back to page 1", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<AgingInvoicesPage />);
    await screen.findByText("Page 1 of 57");

    await u.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(last().get("page")).toBe("2"));

    await u.click(screen.getByRole("button", { name: "Sort by Total" }));
    await waitFor(() => expect(last().get("sort")).toBe("total"));
    expect(last().get("dir")).toBe("asc");
    expect(last().get("page")).toBe("1");
    expect(screen.getByRole("columnheader", { name: /Total/ })).toHaveAttribute("aria-sort", "ascending");

    await u.click(screen.getByRole("button", { name: "Sort by Total" }));
    await waitFor(() => expect(last().get("dir")).toBe("desc"));

    await u.click(screen.getByRole("button", { name: /under 30 days/ }));
    await waitFor(() => expect(last().get("bucket")).toBe("under30"));
    expect(last().get("sort")).toBe("total");
    expect(last().get("dir")).toBe("desc");
    expect(last().get("page")).toBe("1");
    expect(screen.getByRole("button", { name: /under 30 days/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("the page size lives in the strip and starts over at page 1", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<AgingInvoicesPage />);
    await screen.findByText("Page 1 of 57");
    await u.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(last().get("page")).toBe("2"));
    await u.selectOptions(screen.getByRole("combobox", { name: "Rows per page" }), "100");
    await waitFor(() => expect(last().get("pageSize")).toBe("100"));
    expect(last().get("page")).toBe("1");
  });

  it("an empty card reads No Records Found", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<AgingInvoicesPage />);
    await u.click(await screen.findByRole("button", { name: /60-90 days/ }));
    expect(await screen.findByText("No Records Found")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 0 of 0 results")).toBeInTheDocument();
  });

  it("without financials.view: counts on the cards, no Total / Balance, no Export", async () => {
    mocks.money = false;
    renderWithClient(<AgingInvoicesPage />);
    expect(await screen.findByRole("button", { name: "564 invoices due" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "34 under 30 days" })).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Invoice No.", "Invoice Name", "Client name", "Due on", "Created", "Days Late"]);
    expect(screen.queryByRole("button", { name: /Export/ })).toBeNull();
  });

  it("refuses without invoices.view", () => {
    mocks.canView = false;
    renderWithClient(<AgingInvoicesPage />);
    expect(screen.getByText(/don't have permission to view invoices/i)).toBeInTheDocument();
  });
});
