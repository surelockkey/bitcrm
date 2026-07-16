"use client";

import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyContainer } from "../hooks";
import { ContainerStockTab } from "./container-stock-tab";

export function MyContainerView() {
  const { data: container, isLoading, isError } = useMyContainer();

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="border-b px-6 py-4">
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="p-6">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !container) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No container</h2>
        <p className="text-sm text-muted-foreground">
          Containers are provisioned for technicians. Yours isn&apos;t available.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
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
        <ContainerStockTab containerId={container.id} readOnly />
      </div>
    </div>
  );
}
