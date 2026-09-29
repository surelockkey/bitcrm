"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileSpreadsheet, Loader2 } from "lucide-react";
import { ESTIMATE_STATUSES, type Estimate, type EstimateStatus } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { ListPagination } from "@/components/ui/list-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { FilterChip, NoAccess } from "@/features/billing/components/list-bits";
import { useEstimateList, useEstimateSummary , useEstimateCount } from "../hooks";
import { estimateStatusLabel } from "../lib";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";

const PAGE_SIZE = 50;

/**
 * Every column of the list, in order, with the width it starts at.
 *
 * `table-fixed` on purpose: the client name comes from its own contacts
 * request and lands after the rows, and under auto layout the grid would
 * re-measure itself when it does. Declared once — the colgroup and the
 * headers are both built from here, and the reader's own widths are kept
 * under `estimates`, the same name the page size is saved under.
 */
const COLUMNS: { id: string; label: string; width: number; right?: boolean }[] = [
  { id: "number", label: "Estimate #", width: 130 },
  { id: "name", label: "Name", width: 220 },
  { id: "client", label: "Client", width: 200 },
  { id: "created", label: "Created", width: 120 },
  { id: "total", label: "Total", width: 120, right: true },
  { id: "status", label: "Status", width: 130 },
  { id: "job", label: "Job", width: 110 },
];

const COLUMN_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.width]),
);

export function EstimatesPage() {
  const { can  } = usePermissions();
  const denied = useDenied();
  const canView = can("estimates", "view");
  const [status, setStatus] = useState<EstimateStatus | "all">("all");
  const summary = useEstimateSummary(canView);

  // `canView` still gates the query — it must not fetch on a maybe.
  // The refusal is the other way round: only once the answer is in.
  if (denied("estimates", "view")) return <NoAccess what="estimates" />;

  const chip = (value: EstimateStatus | "all", label: string) => {
    const b = summary.data?.[value];
    return (
      <FilterChip key={value} active={status === value} onClick={() => setStatus(value)}>
        {label}
        {b ? (
          <span className="font-normal text-muted-foreground tabular-nums">
            {b.count} · {formatMoney(b.amount)}
          </span>
        ) : null}
      </FilterChip>
    );
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Estimates</h1>
        <p className="text-xs text-muted-foreground">Create estimates from a job&apos;s Estimates tab.</p>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap gap-2" aria-label="Filter by status">
          {chip("all", "All")}
          {ESTIMATE_STATUSES.map((s) => chip(s, estimateStatusLabel(s)))}
        </div>
        <EstimatesTable status={status === "all" ? undefined : status} />
      </div>
    </div>
  );
}

function EstimatesTable({ status }: { status?: EstimateStatus }) {
  const router = useRouter();
  const [pageSize, setPageSize] = usePageSize("estimates");
  const q = useEstimateList({ status, limit: pageSize });
  const count = useEstimateCount({ status });
  const pager = usePager(pagedSource(q, (page: { items: Estimate[] }) => page.items), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ status, pageSize }),
  });
  const rows: Estimate[] = pager.items;
  const { map: contacts } = useContactsByIds(rows.map((r) => r.contactId));
  // The reader's own widths for this list; the declarations only set the start.
  const { widthOf, setWidth, reset } = useColumnWidths("estimates", COLUMN_WIDTHS);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(q.error, "Couldn't load estimates")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <FileSpreadsheet className="size-6" />
        <p className="text-sm">{status ? `No ${estimateStatusLabel(status).toLowerCase()} estimates.` : "No estimates yet."}</p>
      </div>
    );
  }

  const open = (e: Estimate) => router.push(`/deals/${e.dealId}?tab=estimates&estimate=${e.id}`);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto border">
        <Table className="table-fixed">
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.id} style={{ width: widthOf(c.id) }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((c) => (
                <ResizableHead
                  key={c.id}
                  columnId={c.id}
                  label={c.label}
                  width={widthOf(c.id)}
                  onResize={(px) => setWidth(c.id, px)}
                  onReset={reset}
                  className={c.right ? "text-right" : undefined}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => {
              const c = contacts.get(e.contactId);
              return (
                <TableRow
                  key={e.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => open(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") open(e);
                  }}
                >
                  {/* Under `table-fixed` a cell that does not clip spills over
                      the next column instead of widening its own. */}
                  <TableCell className="truncate font-mono font-medium">#{e.number}</TableCell>
                  <TableCell className="truncate">{e.name || "—"}</TableCell>
                  <TableCell className="truncate">{c ? contactName(c) : "—"}</TableCell>
                  <TableCell className="truncate text-muted-foreground tabular-nums">{formatYmd(e.estimateDate || e.createdAt)}</TableCell>
                  <TableCell className="truncate text-right font-mono tabular-nums">{formatMoney(e.totals?.total ?? 0)}</TableCell>
                  <TableCell className="overflow-hidden"><EstimateStatusBadge status={e.status} /></TableCell>
                  <TableCell className="overflow-hidden">
                    <Link
                      href={`/deals/${e.dealId}`}
                      onClick={(ev) => ev.stopPropagation()}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      #{e.dealNumber} <ExternalLink className="size-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
    </div>
  );
}
