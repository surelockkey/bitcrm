"use client";

import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyContainer } from "../hooks";
import { ContainerStockSkeleton, ContainerStockTab } from "./container-stock-tab";

/** One header for both states: loading, it holds the loaded header's height. */
const HEADER = "flex items-center gap-3 border-b px-6 py-4";

export function MyContainerView() {
  const { data: container, isLoading, isError } = useMyContainer();

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <div data-testid="my-container-header" aria-busy="true" className={HEADER}>
          <Skeleton className="size-9 flex-none rounded-lg" />
          {/* The title's 28px line and the subtitle's 20px: 48px, as loaded. */}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-6 py-6">
          <ContainerStockSkeleton />
        </div>
      </div>
    );
  }

  if (isError || !container) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No container assigned</h2>
        <p className="text-sm text-muted-foreground">
          Ask a manager to assign a container to you.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div data-testid="my-container-header" className={HEADER}>
        <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Truck className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">My Container</h1>
          <p className="text-sm text-muted-foreground">
            What&apos;s on your truck{container.department ? ` · ${container.department}` : ""}.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 font-normal">
          <span className="size-1.5 rounded-full bg-green-500" />
          Active
        </Badge>
      </div>
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-6 py-6">
        <ContainerStockTab containerId={container.id} />
      </div>
    </div>
  );
}
