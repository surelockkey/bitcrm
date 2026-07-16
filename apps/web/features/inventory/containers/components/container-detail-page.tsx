"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryStatus } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContainer } from "../hooks";
import { containerTitle } from "../lib";
import { ContainerStockTab, type ContainerMoveTarget } from "./container-stock-tab";
import { ContainerActivityTab } from "./container-activity-tab";
import { ContainerMoveDialog } from "./container-move-dialog";

export function ContainerDetailPage({ containerId }: { containerId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const query = useContainer(containerId);
  const [tab, setTab] = useState("stock");
  const [moveTarget, setMoveTarget] = useState<ContainerMoveTarget | null>(null);

  const canMove = can("transfers", "create") && can("containers", "view");

  if (!can("containers", "view")) {
    return <Center title="No access" body="You don't have permission to view containers." />;
  }
  if (query.isLoading) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    return (
      <Center
        title="Container not found"
        body="It may not exist."
        action={
          <Button variant="outline" onClick={() => router.push("/inventory/containers")}>
            Back to containers
          </Button>
        }
      />
    );
  }

  const container = query.data;
  const inactive = container.status === InventoryStatus.ARCHIVED;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/inventory/containers")}>
          <ArrowLeft className="size-4" />
          Containers
        </Button>
        <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Truck className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{containerTitle(container)}</h1>
          <div className="truncate text-xs text-muted-foreground">
            <Link href={`/technicians/${container.technicianId}`} className="inline-flex items-center gap-0.5">
              {container.technicianName || "Technician"} <ArrowUpRight className="size-3" />
            </Link>
            {container.department ? ` · ${container.department}` : ""}
          </div>
        </div>
        <Badge variant="outline" className={cn("gap-1.5 font-normal", inactive ? "text-muted-foreground" : "text-foreground")}>
          <span className={cn("size-1.5 rounded-full", inactive ? "bg-muted-foreground/50" : "bg-green-500")} />
          {inactive ? "Inactive" : "Active"}
        </Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <div className="border-b px-6">
          <div className="mx-auto max-w-5xl">
            <TabsList variant="line" className="h-11">
              <TabsTrigger value="stock" className="px-2">Stock</TabsTrigger>
              <TabsTrigger value="activity" className="px-2">Activity</TabsTrigger>
            </TabsList>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-6 py-6">
            <TabsContent value="stock" className="mt-0">
              <ContainerStockTab
                containerId={containerId}
                readOnly={!canMove}
                onMove={canMove ? setMoveTarget : undefined}
              />
            </TabsContent>
            <TabsContent value="activity" className="mt-0">
              <ContainerActivityTab containerId={containerId} />
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <ContainerMoveDialog
        containerId={containerId}
        item={moveTarget}
        open={moveTarget !== null}
        onOpenChange={(o) => !o && setMoveTarget(null)}
      />
    </div>
  );
}

function Center({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="mx-auto w-full max-w-5xl p-6">
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
