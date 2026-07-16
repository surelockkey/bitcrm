"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Loader2, Plus, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/users/lib";
import { usePermissions } from "@/features/auth/use-permissions";
import { useTransfers, useLocationMap } from "../hooks";
import { filterByType, matchesSearch } from "../lib";
import { TransferTypeBadge } from "./transfer-type-badge";
import { TransferRoute } from "./transfer-route";
import { TransferRecordDialog } from "./transfer-record-dialog";
import { NewTransferDialog } from "./new-transfer-dialog";

const TYPE_CHIPS: { value: TransferType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: TransferType.RECEIVE, label: "Receive" },
  { value: TransferType.TRANSFER, label: "Transfer" },
  { value: TransferType.DEDUCT, label: "Deduct" },
  { value: TransferType.RESTORE, label: "Restore" },
];

function itemsSummary(t: Transfer): { text: string; more: number } {
  const shown = t.items.slice(0, 2).map((i) => `${i.productName} ×${i.quantity}`);
  return { text: shown.join(", "), more: Math.max(0, t.items.length - 2) };
}

export function TransfersPage() {
  const { can } = usePermissions();
  const query = useTransfers();
  const { map } = useLocationMap();
  const [type, setType] = useState<TransferType | "all">("all");
  const [search, setSearch] = useState("");
  const [record, setRecord] = useState<Transfer | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const transfers = useMemo(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );
  const visible = useMemo(
    () => filterByType(transfers, type).filter((t) => matchesSearch(t, search, map)),
    [transfers, type, search, map],
  );

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
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Transfers</h1>
          <p className="text-sm text-muted-foreground">Every stock movement across warehouses, containers, and jobs.</p>
        </div>
        {can("transfers", "create") ? (
          <Button variant="brand" className="h-9 gap-1.5 px-3.5" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" />
            New transfer
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="inline-flex overflow-hidden rounded-lg border text-xs">
          {TYPE_CHIPS.map((c, i) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setType(c.value)}
              className={cn(
                "px-3 py-1.5 transition-colors",
                i > 0 && "border-l",
                type === c.value ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or person"
            className="h-9 pl-8"
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">
          {visible.length}
          {query.hasNextPage ? "+" : ""} {visible.length === 1 ? "movement" : "movements"}
        </span>
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
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ArrowLeftRight className="size-6" />
            </div>
            <div>
              <div className="font-medium">{transfers.length ? "No movements match" : "No transfers yet"}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {transfers.length ? "Try clearing the filter or search." : "Receiving, transferring, or using stock on a job will show up here."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Type</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((t) => {
                    const { text, more } = itemsSummary(t);
                    return (
                      <TableRow key={t.id} className="cursor-pointer" onClick={() => setRecord(t)}>
                        <TableCell><TransferTypeBadge type={t.type} /></TableCell>
                        <TableCell className="max-w-[280px]"><TransferRoute transfer={t} locationMap={map} /></TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm">
                          {text}
                          {more > 0 ? <span className="text-muted-foreground"> +{more}</span> : null}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate text-sm text-muted-foreground">{t.performedByName}</TableCell>
                        <TableCell className="text-right text-sm whitespace-nowrap text-muted-foreground">{formatDate(t.createdAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {query.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} className="gap-1.5">
                  {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
                  Load more
                </Button>
              </div>
            ) : null}
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
