"use client";

import { useMemo, useState } from "react";
import { TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect } from "@/components/workiz/toolbar";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/inventory/components/no-access";
import { LocationsBand } from "@/features/inventory/components/locations-grid";
import { useInventoryPageReady } from "@/features/inventory/components/inventory-frame";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { settled } from "@/lib/use-page-ready";
import { useTransfers, useLocationMap, useTransfersCount } from "../hooks";
import type { TransferFilter } from "../api";
import { TransferRecordDialog } from "./transfer-record-dialog";
import { NewTransferDialog } from "./new-transfer-dialog";
import { TRANSFERS_TABLE_KEY, TransfersTable } from "./transfers-table";

/** The journal's type box. The server filters by it, the count included. */
const TYPES: { value: TransferType | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  { value: TransferType.RECEIVE, label: "Receive" },
  { value: TransferType.TRANSFER, label: "Transfer" },
  { value: TransferType.DEDUCT, label: "Deduct" },
  { value: TransferType.RESTORE, label: "Restore" },
  { value: TransferType.RETURN, label: "Return" },
];

/**
 * Transfers — BitCRM's movement journal (Workiz shows no such list), drawn as
 * Workiz's Locations tab: Add New in the band; the strip with the type box
 * and the page size (no Search: the server cannot search the journal); the
 * grid with the pager in it. A row opens the movement's record.
 */
export function TransfersPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const [pageSize, setPageSize] = usePageSize(TRANSFERS_TABLE_KEY, { sizes: WZ_GRID_PAGE_SIZES, fallback: 10 });
  const [type, setType] = useState<TransferType | "all">("all");
  // The type goes to the server with the page and the count: filtering the
  // one page on screen showed a different handful on every page under a page
  // count that didn't match.
  const filter: TransferFilter = useMemo(() => (type === "all" ? {} : { type }), [type]);
  const query = useTransfers(filter, pageSize);
  const names = useLocationMap();
  const [record, setRecord] = useState<Transfer | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const count = useTransfersCount(filter);
  const src = pagedSource(query);
  const pager = usePager(query.isPlaceholderData ? { ...src, hasNextPage: false } : src, {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const transfers = pager.items;
  // One loader, then the journal whole: the rows wait for the count (the
  // pager's "of N") and for the names of the warehouses and vans their routes
  // run between. Latched: another type keeps the rows on screen, dimmed.
  const ready = useInventoryPageReady(settled(query) && settled(count) && !names.isLoading);
  const failed = query.isError && !query.data;

  // Refused only once the permissions are known — never a flash of "No access".
  if (denied("transfers", "view")) {
    return <NoAccess text="You don't have permission to view transfers." />;
  }

  return (
    <div className="flex flex-col">
      <LocationsBand
        canAdd={permsLoading || can("transfers", "create")}
        pending={permsLoading}
        onAdd={() => setNewOpen(true)}
      />

      <WzListToolbar data-testid="transfers-toolbar" className="shrink-0">
        <Select value={type} onValueChange={(v) => setType(v as TransferType | "all")}>
          <SelectTrigger className="h-10 w-[200px]" aria-label="Transfer type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <WzPageSizeSelect className="ml-auto" value={pageSize} sizes={WZ_GRID_PAGE_SIZES} onChange={setPageSize} />
      </WzListToolbar>

      {failed ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load transfers</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <TransfersTable
          transfers={transfers}
          locationMap={names.map}
          namesPending={names.isLoading}
          onOpen={setRecord}
          loading={!ready}
          stale={query.isPlaceholderData}
          // Drawn with the rows, its total and all — never under the loader.
          footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
        />
      )}

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
