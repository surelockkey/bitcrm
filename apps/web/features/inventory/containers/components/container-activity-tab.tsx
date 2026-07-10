"use client";

import { useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight, History, Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationType, TransferType } from "@bitcrm/types";
import type { Transfer } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/users/lib";
import { transferUnits } from "@/features/inventory/warehouses/lib";
import { useContainerTransfers } from "../hooks";

type Kind = "in" | "out" | "deal";

function classify(t: Transfer, containerId: string): { kind: Kind; title: string } {
  const units = transferUnits(t);
  const u = `${units} ${units === 1 ? "unit" : "units"}`;
  if (t.type === TransferType.DEDUCT) return { kind: "deal", title: `Used ${u} on a deal` };
  if (t.type === TransferType.RESTORE) return { kind: "deal", title: `Restored ${u} from a deal` };
  const toHere = t.toType === LocationType.CONTAINER && t.toId === containerId;
  if (toHere) {
    const src = t.fromType === LocationType.WAREHOUSE ? "a warehouse" : "another container";
    return { kind: "in", title: `Restocked ${u} from ${src}` };
  }
  const dest = t.toType === LocationType.WAREHOUSE ? "a warehouse" : "another container";
  return { kind: "out", title: `Moved ${u} to ${dest}` };
}

export function ContainerActivityTab({ containerId }: { containerId: string }) {
  const query = useContainerTransfers(containerId);
  const transfers = useMemo(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Couldn&apos;t load activity.
      </p>
    );
  }
  if (transfers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <History className="size-6" />
        </div>
        <div>
          <div className="font-medium">No movement yet</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Restocks, returns, handoffs, and deal usage will show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="divide-y rounded-lg border">
        {transfers.map((t) => {
          const { kind, title } = classify(t, containerId);
          return (
            <div key={t.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={cn(
                  "flex size-8 flex-none items-center justify-center rounded-full",
                  kind === "in"
                    ? "bg-green-500/10 text-green-600 dark:text-green-500"
                    : kind === "deal"
                      ? "bg-muted text-muted-foreground"
                      : "bg-brand/10 text-brand",
                )}
              >
                {kind === "in" ? (
                  <ArrowDownLeft className="size-4" />
                ) : kind === "deal" ? (
                  <Receipt className="size-4" />
                ) : (
                  <ArrowUpRight className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
                  {t.notes ? ` · ${t.notes}` : ""}
                  {t.performedByName ? ` · by ${t.performedByName}` : ""}
                </div>
              </div>
              <span className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(t.createdAt)}</span>
            </div>
          );
        })}
      </div>
      {query.hasNextPage ? (
        <div className="flex justify-center pt-3">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
