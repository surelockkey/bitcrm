"use client";

import { useMemo, useState } from "react";
import { PackageX, Search, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useContainerStockView, useMyContainer } from "@/features/inventory/containers/hooks";
import { containerTitle } from "@/features/inventory/containers/lib";
import { filterStockRows, sortStockRows } from "../lib";

/**
 * `/my-stock` — what is on the van, for the person standing at its back door.
 *
 * A list, not the office's table: the part, how many are left, and a mark when
 * that is nearly none. Low stock floats to the top because it is the only row
 * that needs doing something about. Read-only — a technician moves stock by
 * putting it on a job, and the office does the restocking.
 */
export function MyStockPage() {
  const { can } = usePermissions();
  const { data: container, isLoading: containerLoading, isError: containerError } = useMyContainer();
  const stock = useContainerStockView(container?.id ?? "", Boolean(container?.id));
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () => sortStockRows(filterStockRows(stock.rows, search)),
    [stock.rows, search],
  );

  if (!can("containers", "view")) return <NoAccess entity="stock" />;

  if (containerLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (containerError || !container) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Truck className="size-8 text-muted-foreground" />
        <h2 className="text-lg font-medium">No van assigned</h2>
        <p className="max-w-xs text-sm text-muted-foreground">
          Ask the office to assign you a container — your stock shows up here once they do.
        </p>
      </div>
    );
  }

  const { summary } = stock;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">My Stock</h1>
        <p className="text-sm text-muted-foreground">
          {containerTitle(container)}
          {container.department ? ` · ${container.department}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Chip label={`${summary.skuCount} item${summary.skuCount === 1 ? "" : "s"}`} />
          <Chip label={`${summary.totalUnits.toLocaleString()} on hand`} />
          {summary.lowCount > 0 ? <Chip label={`${summary.lowCount} low`} tone="warn" /> : null}
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts, SKU, category…"
            aria-label="Search my stock"
            className="h-11 pl-9"
            data-testid="my-stock-search"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-3 sm:px-6">
          {stock.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : stock.isError ? (
            <Empty title="Couldn't load your stock" body="Check your connection and try again." />
          ) : rows.length === 0 ? (
            <Empty
              title={search ? "Nothing matches" : "Empty van"}
              body={
                search
                  ? "No part on your van matches that."
                  : "Nothing on your van yet — the office restocks it with a transfer."
              }
            />
          ) : (
            <ul className="space-y-2" data-testid="my-stock-list">
              {rows.map((r) => (
                <li
                  key={r.productId}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4"
                  data-testid="my-stock-row"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[r.sku, r.category].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex-none text-right">
                    <p
                      className={cn(
                        "text-xl font-semibold tabular-nums",
                        r.isLow && "text-amber-600 dark:text-amber-500",
                      )}
                    >
                      {r.quantity}
                    </p>
                    {r.isLow ? (
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                        Low
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, tone }: { label: string; tone?: "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip border px-2.5 py-1 font-medium",
        tone === "warn"
          ? "border-amber-500/40 text-amber-600 dark:text-amber-500"
          : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <PackageX className="size-6" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
