"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { AGING_BUCKETS, type AgingBucket, type AgingRow, type AgingSort } from "@bitcrm/types";
import { WzKpiCard, WzKpiCardSkeleton } from "@/components/workiz/kpi-card";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, wzNextSort, type WzReportColumn } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzToolbarButton } from "@/components/workiz/toolbar";
import { getApiErrorMessage } from "@/lib/api/errors";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { DEFAULT_REPORT_PAGE_SIZE, REPORT_PAGE_SIZES } from "@/features/payments/report";
import { exportAging } from "../api";
import {
  AGING_CARD_TONES,
  agingCardText,
  agingColumnIds,
  agingPager,
  agingParams,
  agingSubline,
  type AgingGridSort,
} from "../aging";
import { useAging } from "../hooks";
import { downloadCsv, workizDate } from "../lib";
import { money } from "./report-bits";

/** A value alone in its cell: one line, cut at the cell's edge as react-table cuts it. */
const Text = ({ children }: { children?: React.ReactNode }) => <span className="block truncate">{children}</span>;

/** Workiz's columns (rep_aging_wz_01_default): all left-aligned, money too. */
const COLUMNS: Record<AgingSort, WzReportColumn<AgingRow>> = {
  number: {
    id: "number",
    label: "Invoice No.",
    sortable: true,
    // Ink, no change under the cursor (rep_aging_wz_03b_invoice_hover); the
    // invoice opens in place, as Workiz's /root/invoice/<no> does.
    cell: (r) => (
      <Link
        href={r.dealId ? `/deals/${r.dealId}?tab=invoice` : `/invoices/${r.invoiceId}`}
        className="text-foreground no-underline"
      >
        {r.number}
      </Link>
    ),
  },
  name: { id: "name", label: "Invoice Name", sortable: true, cell: (r) => <Text>{r.name ?? ""}</Text> },
  client: {
    id: "client",
    label: "Client name",
    sortable: true,
    // Workiz's ClientTableCell: the name (h5 16px/24px ink), then the email
    // (12px/18px) or, without one, the phone as a blue call link. Workiz's
    // name opens its client side panel; ours opens the client's page in a
    // tab of its own, so the report stays put.
    cell: (r) => {
      const sub = agingSubline(r);
      return (
        <div>
          <Link
            href={`/contacts/${r.contactId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-base leading-6 tracking-[0.2px] text-foreground no-underline"
          >
            {r.clientName ?? ""}
          </Link>
          {sub?.kind === "email" ? (
            <div className="text-xs leading-[18px] text-foreground">{sub.text}</div>
          ) : sub?.kind === "phone" ? (
            <a href={`tel:${sub.tel}`} className="table text-sm leading-4 text-wz-link no-underline">
              {sub.text}
            </a>
          ) : null}
        </div>
      );
    },
  },
  total: { id: "total", label: "Total", sortable: true, cell: (r) => <Text>{money(r.total)}</Text> },
  balance: { id: "balance", label: "Balance", sortable: true, cell: (r) => <Text>{money(r.balance)}</Text> },
  dueDate: { id: "dueDate", label: "Due on", sortable: true, cell: (r) => <Text>{workizDate(r.dueDate)}</Text> },
  createdAt: { id: "createdAt", label: "Created", sortable: true, cell: (r) => <Text>{workizDate(r.createdAt)}</Text> },
  daysLate: { id: "daysLate", label: "Days Late", sortable: true, cell: (r) => <Text>{r.daysLate}</Text> },
};

/**
 * Workiz Reports → Aging invoices (`/root/agingInvoices`), drawn as Workiz
 * draws it (rep_aging_wz_*): no title and no date — five cards that ARE the
 * filter (every unpaid invoice, then the overdue ones by Days Late), the list
 * strip (page size, Export), the eight-column grid with the pager inside it.
 * Always "as of today" on the account's clock; the server counts, sorts
 * (any header, ascending first; its own order until one is clicked) and pages.
 *
 * Needs `invoices.view`; the money (card figures, Total, Balance, the CSV)
 * needs `financials.view` as well — without it the cards count invoices.
 */
export function AgingInvoicesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("invoices", "view");
  const showMoney = can("financials", "view");
  const [bucket, setBucket] = useState<AgingBucket>("all");
  const [sort, setSort] = useState<AgingGridSort>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_REPORT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);
  const q = useAging(agingParams({ bucket, sort, page, pageSize }), canView);
  // The cards, their figures, the index note and the rows come in one frame:
  // a right-aligned "$235,074.06" drawn after a placeholder slides, and the
  // note arriving later pushes the grid down.
  const ready = usePageReady(!permsLoading && settled(q));

  if (denied("invoices", "view")) return <NoAccess what="invoices" />;

  const r = ready ? q.data : undefined;
  const pick = (b: AgingBucket) => {
    setBucket(b);
    setPage(1);
  };
  const onSort = (column: string) => {
    setSort((s) => ({ column, dir: s?.column === column ? wzNextSort(s.dir) : "asc" }));
    setPage(1);
  };
  const runExport = async () => {
    setExporting(true);
    try {
      // The card and the sort on screen; the export leaves the paging out itself.
      const out = await exportAging(agingParams({ bucket, sort, page, pageSize }));
      downloadCsv(out.filename, out.csv);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Couldn't export the report"));
    } finally {
      setExporting(false);
    }
  };
  const columns = agingColumnIds(showMoney).map((id) => COLUMNS[id]);
  const pager = agingPager({
    page,
    pageSize,
    total: r?.total ?? 0,
    shown: r?.items.length ?? 0,
    fetching: q.isFetching,
    onPage: setPage,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="aging-invoices-report">
      {/* The cards (rep_aging_wz_01_default): 34px under the breadcrumbs,
          30px in, 18px apart, 19px off the right edge; 75px down to the strip. */}
      <div className="grid shrink-0 grid-cols-5 gap-[18px] pt-[34px] pr-[19px] pb-[75px] pl-[30px]">
        {AGING_BUCKETS.map((b) => {
          if (!r) return <WzKpiCardSkeleton key={b} tone={AGING_CARD_TONES[b]} />;
          const text = agingCardText(b, r.cards[b], showMoney);
          return (
            <WzKpiCard
              key={b}
              tone={AGING_CARD_TONES[b]}
              value={text.value}
              caption={text.caption}
              label={text.label}
              selected={bucket === b}
              onSelect={() => pick(b)}
            />
          );
        })}
      </div>

      {/* Workiz's strip has no Search here: 65px, the page size and Export at the right. */}
      <WzListToolbar className="min-h-[65px]">
        {r && !r.indexReady ? (
          // Ours alone: the note sits where Workiz's strip keeps its empty left section.
          <p role="status" className="text-xs text-wz-caption">
            The unpaid-invoice index is not built on this environment yet — figures come from a full read and are slower.
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect
            value={pageSize}
            sizes={REPORT_PAGE_SIZES}
            onChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
          {showMoney ? (
            <WzToolbarButton onClick={() => void runExport()} disabled={exporting}>
              <FileText strokeWidth={1.5} /> {exporting ? "Exporting…" : "Export"}
            </WzToolbarButton>
          ) : null}
        </div>
      </WzListToolbar>

      <div className="flex-1">
        {q.isError && !q.data ? (
          <p role="alert" className="px-5 py-4 text-sm text-destructive">
            {getApiErrorMessage(q.error, "Couldn't load the report")}
          </p>
        ) : (
          <WzReportGrid
            aria-label="Aging invoices"
            columns={columns}
            rows={r?.items ?? []}
            rowKey={(row) => row.invoiceId}
            sort={sort}
            onSort={onSort}
            loading={!r}
            busy={q.isPlaceholderData}
            footer={r ? <WzPager pager={pager} plainNumbers /> : null}
          />
        )}
      </div>
    </div>
  );
}
