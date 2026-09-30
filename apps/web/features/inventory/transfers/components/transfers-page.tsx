"use client";

import { useState } from "react";
import { ArrowLeftRight, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { Skeleton } from "@/components/ui/skeleton";
import type { Transfer } from "@bitcrm/types";
import { formatDate } from "@/features/users/lib";
import { usePermissions } from "@/features/auth/use-permissions";
import { useTransfers, useLocationMap, useTransfersCount } from "../hooks";
import { TransferTypeBadge } from "./transfer-type-badge";
import { TransferRoute } from "./transfer-route";
import { TransferRecordDialog } from "./transfer-record-dialog";
import { NewTransferDialog } from "./new-transfer-dialog";
import { ListPagination } from "@/components/ui/list-pagination";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { TableFrame } from "@/features/inventory/components/table-frame";

/**
 * The columns, with the width each one starts at — read by both the
 * `<colgroup>` and the headers, so there is one number to change.
 */
const COLUMNS: { id: string; label: string; width: number }[] = [
  { id: "type", label: "Type", width: 120 },
  { id: "route", label: "Route", width: 280 },
  { id: "items", label: "Items", width: 240 },
  { id: "by", label: "By", width: 160 },
  { id: "when", label: "When", width: 150 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** The list's own key: the same name its page-size preference is saved under. */
const TABLE_KEY = "inventory-transfers";

function itemsSummary(t: Transfer): { text: string; more: number } {
  const shown = t.items.slice(0, 2).map((i) => `${i.productName} ×${i.quantity}`);
  return { text: shown.join(", "), more: Math.max(0, t.items.length - 2) };
}

export function TransfersPage() {
  const { can } = usePermissions();
  const [pageSize, setPageSize] = usePageSize(TABLE_KEY);
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);
  const query = useTransfers(pageSize);
  const { map } = useLocationMap();
  const [record, setRecord] = useState<Transfer | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const count = useTransfersCount();
  const pager = usePager(pagedSource(query), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: String(pageSize),
  });
  // No type chips or search here: GET /inventory/transfers filters on
  // neither, and filtering the one page on screen shows a different handful
  // on every page under a page count that doesn't match.
  const transfers = pager.items;

  if (!can("transfers", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view transfers.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        {/* Скільки всього — під таблицею; тут було б число однієї сторінки. */}
        <span className="ml-auto" />
        {can("transfers", "create") ? (
          <Button variant="brand" className="h-9 gap-1.5 px-3.5" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" />
            New transfer
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        {query.isLoading ? (
          <div className="space-y-2 rounded-lg border p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <TriangleAlert className="size-6" />
            </div>
            <div className="font-medium">Couldn&apos;t load transfers</div>
            <Button variant="outline" onClick={() => query.refetch()}>Retry</Button>
          </div>
        ) : transfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ArrowLeftRight className="size-6" />
            </div>
            <div>
              <div className="font-medium">No transfers yet</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Receiving, transferring, or using stock on a job will show up here.
              </p>
            </div>
          </div>
        ) : (
          <>
            <TableFrame>
              {/* `table-fixed`: the column decides its width, not the
                  longest item list on the page — and the reader can drag
                  the edge. */}
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
                      />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((t) => {
                    const { text, more } = itemsSummary(t);
                    return (
                      <TableRow key={t.id} className="cursor-pointer" onClick={() => setRecord(t)}>
                        {/* Every cell clips: under fixed layout one that
                            doesn't spills over the next column instead of
                            widening its own. */}
                        <TableCell className="overflow-hidden"><TransferTypeBadge type={t.type} /></TableCell>
                        <TableCell className="overflow-hidden"><TransferRoute transfer={t} locationMap={map} /></TableCell>
                        <TableCell className="truncate text-sm">
                          {text}
                          {more > 0 ? <span className="text-muted-foreground"> +{more}</span> : null}
                        </TableCell>
                        <TableCell className="truncate text-sm text-muted-foreground">{t.performedByName}</TableCell>
                        <TableCell className="truncate text-sm text-muted-foreground">{formatDate(t.createdAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableFrame>
            <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
          </>
        )}
      </div>

      <TransferRecordDialog
        transfer={record}
        locationMap={map}
        open={record !== null}
        onOpenChange={(o) => !o && setRecord(null)}
      />
      <NewTransferDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
