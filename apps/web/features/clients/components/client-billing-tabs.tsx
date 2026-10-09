"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import type { Address, Deal, Estimate, Invoice, Payment } from "@bitcrm/types";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { DEFAULT_TZ } from "@/lib/timezone";
import { workizDateTime } from "@/features/deals/schedule-cell";
import { estimateStatusLabel } from "@/features/estimates/lib";
import { paymentMethodLabel, paymentStatusLabel } from "@/features/payments/lib";
import { wzDayStart, wzMoney } from "../client-page";
import { openRow, PLAIN_LINK } from "./client-jobs-tab";

/** Where an invoice lives: its job's Invoice tab, or — with no job — its own page. */
const invoiceHref = (inv: Pick<Invoice, "id" | "dealId">) => (inv.dealId ? `/deals/${inv.dealId}?tab=invoice` : `/invoices/${inv.id}`);

/** "534 Newfield St, Middletown, Connecticut 06457" — one line, as Workiz's Address column. */
function oneLine(a: Address | undefined): string {
  if (!a?.street) return "";
  const street = a.unit ? `${a.street} ${a.unit}` : a.street;
  const tail = [a.state, a.zip].filter(Boolean).join(" ");
  return [street, a.city, tail].filter(Boolean).join(", ");
}

/** Workiz's blue link (an invoice Id): #3589e9, underlined. */
const BLUE_LINK = "text-brand underline underline-offset-2 outline-none hover:text-wz-accent-hover";

/**
 * Workiz's Estimates tab (pg_contact_wz_269669_tab_estimates): Id | Name |
 * Created | Address | Status | Job, newest first; the row opens the estimate.
 * The address is the estimate's job's, else the client's service address.
 */
export function ClientEstimatesTab({
  estimates,
  dealsById,
  serviceAddress,
}: {
  estimates: Estimate[];
  dealsById: Map<string, Deal>;
  serviceAddress?: Address;
}) {
  const router = useRouter();
  const columns = useMemo<WzGridColumn<Estimate>[]>(() => {
    const address = (e: Estimate) => oneLine((e.dealId ? dealsById.get(e.dealId)?.address : undefined) ?? serviceAddress);
    const created = (e: Estimate) => workizDateTime(e.createdAt, DEFAULT_TZ);
    const job = (e: Estimate) => e.dealNumber ?? (e.dealId ? dealsById.get(e.dealId)?.dealNumber : undefined) ?? "";
    return [
      {
        id: "id",
        label: "Id",
        width: 130,
        sortValue: (e) => e.workizNumber ?? e.number,
        searchText: (e) => e.workizNumber ?? e.number,
        render: (e) => (
          <Link href={`/estimates/${e.id}`} className={PLAIN_LINK}>
            {e.workizNumber ?? e.number}
          </Link>
        ),
      },
      { id: "name", label: "Name", sortValue: (e) => e.name, searchText: (e) => e.name, render: (e) => e.name ?? "" },
      { id: "created", label: "Created", sortValue: (e) => e.createdAt, searchText: created, render: created },
      { id: "address", label: "Address", sortValue: address, searchText: address, render: address },
      {
        id: "status",
        label: "Status",
        sortValue: (e) => estimateStatusLabel(e.status),
        searchText: (e) => estimateStatusLabel(e.status),
        render: (e) => estimateStatusLabel(e.status),
      },
      {
        id: "job",
        label: "Job",
        sortValue: job,
        searchText: job,
        render: (e) =>
          e.dealId ? (
            <Link href={`/deals/${e.dealId}`} className={PLAIN_LINK}>
              {job(e)}
            </Link>
          ) : (
            ""
          ),
      },
    ];
  }, [dealsById, serviceAddress]);

  return (
    <WzLocalGrid
      label="Estimates"
      searchLabel="Search estimates"
      columns={columns}
      rows={estimates}
      rowKey={(e) => e.id}
      defaultSort={{ id: "created", dir: "desc" }}
      onRowClick={(e, ev) => openRow(router, `/estimates/${e.id}`, ev)}
    />
  );
}

/**
 * Workiz's Invoices tab (pg_contact_wz_269669_tab_invoices): "Pay unpaid
 * invoices" beside the Search; Id (a blue link) | Name | Created | Sent |
 * Total | Amount Due | Past Due | Due By, newest first. Figures blank for a
 * role without `financials.view`.
 */
export function ClientInvoicesTab({
  invoices,
  today,
  money,
  onPay,
}: {
  invoices: Invoice[];
  /** The account's "YYYY-MM-DD": past due is the balance once the due date has passed. */
  today: string;
  money: boolean;
  /** "Pay unpaid invoices" (needs `payments.create`); absent hides it. */
  onPay?: () => void;
}) {
  const router = useRouter();
  const columns = useMemo<WzGridColumn<Invoice>[]>(() => {
    const balance = (i: Invoice) => Math.max(0, i.totals?.balanceDue ?? 0);
    const past = (i: Invoice) => (i.dueDate < today ? balance(i) : 0);
    const figure = (n: number) => (money ? wzMoney(n) : "");
    const created = (i: Invoice) => workizDateTime(i.createdAt, DEFAULT_TZ);
    const sent = (i: Invoice) => workizDateTime(i.sentAt, DEFAULT_TZ);
    return [
      {
        id: "id",
        label: "Id",
        width: 130,
        sortValue: (i) => i.number,
        searchText: (i) => i.number,
        render: (i) => (
          <Link href={invoiceHref(i)} className={BLUE_LINK}>
            {i.number}
          </Link>
        ),
      },
      { id: "name", label: "Name", sortValue: (i) => i.workizName, searchText: (i) => i.workizName, render: (i) => i.workizName ?? "" },
      { id: "created", label: "Created", sortValue: (i) => i.createdAt, searchText: created, render: created },
      { id: "sent", label: "Sent", sortValue: (i) => i.sentAt, searchText: sent, render: sent },
      { id: "total", label: "Total", sortValue: (i) => i.totals?.total ?? 0, render: (i) => figure(i.totals?.total ?? 0) },
      { id: "amountDue", label: "Amount Due", sortValue: balance, render: (i) => figure(balance(i)) },
      { id: "pastDue", label: "Past Due", sortValue: past, render: (i) => figure(past(i)) },
      { id: "dueBy", label: "Due By", sortValue: (i) => i.dueDate, searchText: (i) => wzDayStart(i.dueDate), render: (i) => wzDayStart(i.dueDate) },
    ];
  }, [today, money]);

  return (
    <WzLocalGrid
      label="Invoices"
      searchLabel="Search invoices"
      columns={columns}
      rows={invoices}
      rowKey={(i) => i.id}
      defaultSort={{ id: "created", dir: "desc" }}
      onRowClick={(i, e) => openRow(router, invoiceHref(i), e)}
      toolbar={
        onPay ? (
          // pg_contact_wz_269669_tab_invoices: a card glyph and 14px #6aa8ee words, 33px after the Search.
          <button
            type="button"
            onClick={onPay}
            className="ml-[15px] inline-flex items-center gap-2 text-sm leading-[21px] font-medium tracking-[0.4px] text-wz-link outline-none hover:underline focus-visible:underline"
          >
            <CreditCard className="size-[18px]" strokeWidth={1.25} /> Pay unpaid invoices
          </button>
        ) : null
      }
    />
  );
}

/**
 * Workiz's Payments tab: Job Id | Date | Amount | Type | Approval Code |
 * Payment Status (its rows could not be captured — the read-only guard blocks
 * Workiz's payments report), newest first; ours adds the Tip at the end.
 */
export function ClientPaymentsTab({ rows, dealsById, isError }: { rows: Payment[]; dealsById: Map<string, Deal>; isError: boolean }) {
  const columns = useMemo<WzGridColumn<Payment>[]>(() => {
    const job = (p: Payment) => dealsById.get(p.dealId)?.dealNumber ?? p.dealId.slice(0, 8);
    const date = (p: Payment) => workizDateTime(p.takenAt, DEFAULT_TZ);
    return [
      {
        id: "job",
        label: "Job Id",
        width: 130,
        sortValue: job,
        searchText: job,
        render: (p) => (
          <Link href={`/deals/${p.dealId}`} className={BLUE_LINK}>
            {job(p)}
          </Link>
        ),
      },
      { id: "date", label: "Date", sortValue: (p) => p.takenAt, searchText: date, render: date },
      { id: "amount", label: "Amount", sortValue: (p) => p.amount, searchText: (p) => wzMoney(p.amount), render: (p) => wzMoney(p.amount) },
      {
        id: "type",
        label: "Type",
        sortValue: (p) => paymentMethodLabel(p.method),
        searchText: (p) => paymentMethodLabel(p.method),
        render: (p) => paymentMethodLabel(p.method),
      },
      { id: "approval", label: "Approval Code", sortValue: (p) => p.reference, searchText: (p) => p.reference, render: (p) => p.reference ?? "" },
      {
        id: "status",
        label: "Payment Status",
        sortValue: (p) => paymentStatusLabel(p.status),
        searchText: (p) => paymentStatusLabel(p.status),
        render: (p) => paymentStatusLabel(p.status),
      },
      { id: "tip", label: "Tip", sortValue: (p) => p.tipAmount ?? 0, render: (p) => (p.tipAmount ? wzMoney(p.tipAmount) : "") },
    ];
  }, [dealsById]);

  if (isError) return <p className="p-6 text-sm text-wz-danger">Couldn&apos;t load the payments.</p>;
  return <WzLocalGrid label="Payments" searchLabel="Search payments" columns={columns} rows={rows} rowKey={(p) => p.id} defaultSort={{ id: "date", dir: "desc" }} />;
}
