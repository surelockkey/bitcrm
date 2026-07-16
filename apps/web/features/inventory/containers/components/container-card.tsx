"use client";

import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useContainerStockView } from "../hooks";
import { containerTitle } from "../lib";

function compactMoney(n: number): string {
  return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
}

export function ContainerCard({ container }: { container: Container }) {
  const router = useRouter();
  const { summary, isLoading } = useContainerStockView(container.id);
  const inactive = container.status === InventoryStatus.ARCHIVED;

  return (
    <button
      type="button"
      onClick={() => router.push(`/inventory/containers/${container.id}`)}
      className={cn(
        "flex flex-col rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/15 hover:shadow-sm",
        inactive && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Truck className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{containerTitle(container)}</div>
          <div className="truncate text-xs text-muted-foreground">{container.department || "—"}</div>
        </div>
        <Badge
          variant="outline"
          className={cn("gap-1.5 font-normal", inactive ? "text-muted-foreground" : "text-foreground")}
        >
          <span className={cn("size-1.5 rounded-full", inactive ? "bg-muted-foreground/50" : "bg-green-500")} />
          {inactive ? "Inactive" : "Active"}
        </Badge>
      </div>

      <div className="mt-4 flex gap-6 border-t pt-3">
        {isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <>
            <Stat n={summary.skuCount.toLocaleString()} label="SKUs" />
            <Stat n={summary.totalUnits.toLocaleString()} label="On hand" />
            <Stat n={compactMoney(summary.totalValue)} label="Value" />
            <Stat n={String(summary.lowCount)} label="Low" tone={summary.lowCount > 0 ? "warn" : undefined} />
          </>
        )}
      </div>
    </button>
  );
}

function Stat({ n, label, tone }: { n: string; label: string; tone?: "warn" }) {
  return (
    <div>
      <div className={cn("text-base font-semibold tabular-nums", tone === "warn" && "text-amber-600 dark:text-amber-500")}>{n}</div>
      <div className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
