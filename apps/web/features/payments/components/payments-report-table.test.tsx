import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PaymentReportRow } from "@bitcrm/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { PaymentsReportTable, PaymentsReportTableShell, paymentsReportColumns } from "./payments-report-table";

/*
 * Workiz's Payments report grid (rep_payments_wz_01_default, _13_table_right,
 * _15_sort_amount, _20_refunds, _11_empty_search): 14 columns, the ID a blue
 * "<job> (Job)" link, the day as "Thu, Oct 8, 2026", the Status tag only on
 * an electronic line, a refund in parentheses, the client's name over their
 * phone (or email), Technician / Collected by as blue links by their Workiz
 * names, at least ten rows.
 */
const row = (over: Partial<PaymentReportRow> = {}): PaymentReportRow => ({
  id: "p1",
  kind: "payment",
  paymentId: "p1",
  dealId: "d1",
  dealNumber: "JFES75",
  at: "2026-10-08T22:22:25.000Z",
  amount: 239.71,
  tip: 0,
  type: "charge",
  typeLabel: "Credit charge",
  status: "succeeded",
  description: "Approved",
  contactId: "c1",
  clientName: "Janelle Click",
  card: "XXXX4242",
  technicianId: "t1",
  technicianName: "Cannon Burt",
  transactionMethod: "Card reader",
  collectedById: "t1",
  collectedByName: "Cannon Burt",
  jobTypeName: "Rekey lock",
  ...over,
});

const names = new Map([["t1", "(2) TX - Cannon Burt"]]);
const contacts = new Map([
  ["c1", { email: "janellclick@gmail.com" }],
  ["c2", { phone: "4695000793", email: "nevaeh@example.com" }],
]);

function setup(rows: PaymentReportRow[], { money = true, dir = "desc" as const, onSortDate = vi.fn() } = {}) {
  render(
    <PaymentsReportTable
      rows={rows}
      money={money}
      dir={dir}
      onSortDate={onSortDate}
      contactOf={(id) => contacts.get(id)}
      nameOf={(id, fallback) => (id && names.get(id)) || fallback}
    />,
  );
  return { onSortDate };
}

const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent);
const cells = (r: HTMLElement) => within(r).getAllByRole("cell").map((c) => c.textContent);
const dataRows = () => screen.getAllByRole("row").filter((r) => r.closest("tbody") && !r.getAttribute("aria-hidden"));

describe("PaymentsReportTable", () => {
  it("has Workiz's 14 columns in its order; without financials.view the money columns go", () => {
    expect(paymentsReportColumns(true).map((c) => c.label)).toEqual([
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
    expect(paymentsReportColumns(false).map((c) => c.id)).not.toEqual(expect.arrayContaining(["amount"]));
    expect(paymentsReportColumns(false).map((c) => c.id)).not.toContain("tip");
    // react-table's widths: 100px each, Job Type 250.
    expect(paymentsReportColumns(true).map((c) => c.width)).toEqual([...Array(13).fill(100), 250]);
  });

  it("prints a payment line the way Workiz does", () => {
    setup([row()]);
    const r = dataRows()[0];
    expect(cells(r)).toEqual([
      "JFES75 (Job)",
      "$239.71",
      "Thu, Oct 8, 2026",
      "Succeeded",
      "Credit charge",
      "",
      "Approved",
      "Janelle Clickjanellclick@gmail.com",
      "$0.00",
      "XXXX4242",
      "(2) TX - Cannon Burt",
      "Card reader",
      "(2) TX - Cannon Burt",
      "Rekey lock",
    ]);
    expect(within(r).getByRole("link", { name: "JFES75 (Job)" })).toHaveAttribute("href", "/deals/d1");
    expect(within(r).getByRole("link", { name: "Janelle Click" })).toHaveAttribute("href", "/contacts/c1");
    for (const tech of within(r).getAllByRole("link", { name: "(2) TX - Cannon Burt" })) {
      expect(tech).toHaveAttribute("href", "/technicians/t1");
    }
  });

  it("puts the client's phone under the name, as a call link, before the email", () => {
    setup([row({ contactId: "c2", clientName: "Nevaeh Upton" })]);
    const phone = screen.getByRole("link", { name: "(469) 500-0793" });
    expect(phone).toHaveAttribute("href", "tel:4695000793");
    expect(screen.queryByText("nevaeh@example.com")).toBeNull();
  });

  it("leaves the Status empty on an offline line, and writes a refund in parentheses", () => {
    setup([
      row({ id: "c", type: "cash", typeLabel: "Cash", status: undefined, card: undefined, amount: 325 }),
      row({ id: "r", kind: "refund", type: "refund", typeLabel: "Refund", amount: -221.8, tip: 0 }),
      row({ id: "n", type: "credit", typeLabel: "Credit offline", status: undefined, amount: -207 }),
    ]);
    const [cash, refund, credit] = dataRows();
    expect(cells(cash)[3]).toBe("");
    expect(cells(refund).slice(1, 2)).toEqual(["($221.80)"]);
    expect(cells(refund)[8]).toBe("($0.00)");
    expect(cells(credit)[1]).toBe("-$207.00");
  });

  it("names the technician by the row when the directory does not know them", () => {
    setup([row({ technicianId: "t9", technicianName: "Gone Tech", collectedById: undefined, collectedByName: "Office" })]);
    const r = dataRows()[0];
    expect(cells(r)[10]).toBe("Gone Tech");
    expect(cells(r)[12]).toBe("Office");
  });

  it("drops Amount and Tip without financials.view", () => {
    setup([row()], { money: false });
    expect(headers()).not.toContain("Amount");
    expect(headers()).not.toContain("Tip");
    expect(screen.queryByText("$239.71")).toBeNull();
  });

  it("sorts by Payment date only, its bar at the foot when newest first", async () => {
    const { onSortDate } = setup([row()]);
    const date = screen.getByRole("columnheader", { name: /Payment date/ });
    expect(date).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(within(date).getByRole("button", { name: "Sort by Payment date" }));
    expect(onSortDate).toHaveBeenCalled();
    // The rest are not controls.
    expect(within(screen.getByRole("columnheader", { name: /^Amount/ })).queryByRole("button", { name: /Sort/ })).toBeNull();
  });

  it("is never shorter than ten rows, and says No Records Found when empty", () => {
    setup([]);
    expect(screen.getAllByRole("row", { hidden: true }).filter((r) => r.getAttribute("aria-hidden"))).toHaveLength(10);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });

  it("has a loading frame of the same columns", () => {
    render(<PaymentsReportTableShell money />);
    expect(screen.getByRole("status", { name: "Loading payments" })).toBeInTheDocument();
    expect(headers()).toHaveLength(14);
  });
});
