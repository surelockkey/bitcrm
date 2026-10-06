"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/inventory/components/no-access";
import { ListBody } from "@/features/inventory/components/list-body";
import { useSkeletonRows } from "@/features/inventory/components/use-skeleton-rows";
import { useTransfers, useLocationMap, useTransfersCount } from "../hooks";
import type { TransferFilter } from "../api";
import { TransferRecordDialog } from "./transfer-record-dialog";
import { NewTransferDialog } from "./new-transfer-dialog";
import { TRANSFERS_TABLE_KEY, TransfersTable } from "./transfers-table";
import { ListPagination } from "@/components/ui/list-pagination";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { settled, usePageReady } from "@/lib/use-page-ready";

/** Workiz's type chips. The server filters by them, the count included. */
const TYPE_CHIPS: { value: TransferType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: TransferType.RECEIVE, label: "Receive" },
  { value: TransferType.TRANSFER, label: "Transfer" },
  { value: TransferType.DEDUCT, label: "Deduct" },
  { value: TransferType.RESTORE, label: "Restore" },
  { value: TransferType.RETURN, label: "Return" },
];

export function TransfersPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const [pageSize, setPageSize] = usePageSize(TRANSFERS_TABLE_KEY);
  const [type, setType] = useState<TransferType | "all">("all");
  // The type goes to the server with the page and the count: filtering the
  // one page on screen showed a different handful on every page under a page
  // count that didn't match. There is still no search — the server has none.
  const filter: TransferFilter = useMemo(() => (type === "all" ? {} : { type }), [type]);
  const query = useTransfers(filter, pageSize);
  const names = useLocationMap();
  const [record, setRecord] = useState<Transfer | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const count = useTransfersCount(filter);
  const pager = usePager(pagedSource(query), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const transfers = pager.items;
  // One skeleton, then the journal whole: the rows wait for the count (the
  // pager's "of N") and for the names of the warehouses and vans their
  // routes run between — drawn first, every route showed grey bars, then
  // names. Latched: another type keeps the rows on screen, dimmed.
  const ready = usePageReady(settled(query) && settled(count) && !names.isLoading);
  const loading = !ready;
  const failed = query.isError && !query.data;
  const empty = !failed && !loading && transfers.length === 0;
  const skeletonRows = useSkeletonRows(
    TRANSFERS_TABLE_KEY,
    pageSize,
    count.data?.total,
    loading || pager.isStale ? undefined : transfers.length,
  );

  // Refused only once the permissions are known — never a flash of "No access".
  if (denied("transfers", "view")) {
    return <NoAccess text="You don't have permission to view transfers." />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        {/* The row scrolls sideways on its own, as the Inventory tabs do: on a
            phone the six chips are wider than the screen, and clipped,
            "Return" read "Ret" and could not be reached. */}
        <div
          role="group"
          aria-label="Transfer type"
          className="inline-flex max-w-full overflow-x-auto border text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TYPE_CHIPS.map((c, i) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={type === c.value}
              onClick={() => setType(c.value)}
              className={cn(
                "flex-none px-3 py-1.5 whitespace-nowrap transition-colors",
                i > 0 && "border-l",
                type === c.value
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {/* Скільки всього — під таблицею; тут було б число однієї сторінки. */}
        <span className="ml-auto" />
        {permsLoading || can("transfers", "create") ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5 px-3.5"
            disabled={permsLoading}
            onClick={() => setNewOpen(true)}
          >
            <Plus className="size-4" />
            New transfer
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        <ListBody
          holdKey={JSON.stringify(filter)}
          scrollKey={`${pager.page}:${pageSize}`}
          pager={
            // Drawn with the rows, never under the skeleton, where the rows
            // would move it when they land.
            loading || failed || empty ? null : (
              <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
            )
          }
        >
          {failed ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <TriangleAlert className="size-6" />
              </div>
              <div className="font-medium">Couldn&apos;t load transfers</div>
              <Button variant="outline" onClick={() => query.refetch()}>Retry</Button>
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <ArrowLeftRight className="size-6" />
              </div>
              <div>
                <div className="font-medium">
                  {type === "all" ? "No transfers yet" : "No transfers of this type"}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {type === "all"
                    ? "Receiving, transferring, or using stock on a job will show up here."
                    : "Pick another type, or All."}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Loading, loaded or holding the last type's rows — one table,
                  so nothing under it moves when the rows land. */}
              <TransfersTable
                transfers={transfers}
                locationMap={names.map}
                namesPending={names.isLoading}
                onOpen={setRecord}
                loading={loading}
                skeletonRows={skeletonRows}
                stale={pager.isStale}
              />
            </>
          )}
        </ListBody>
      </div>

      <TransferRecordDialog
        transfer={record}
        locationMap={names.map}
        open={record !== null}
        onOpenChange={(o) => !o && setRecord(null)}
      />
      <NewTransferDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
