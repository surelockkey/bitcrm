"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplateDiff } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import type { StockLocation } from "@/features/inventory/stock/lib";
import { LocationPicker } from "@/features/inventory/stock/components/location-picker";
import { TableFrame } from "@/features/inventory/components/table-frame";
import { useContainerTemplate, useFillFromWarehouse, useTemplateDiff } from "../hooks";
import { diffSummary } from "../lib";

const newRequestId = () => crypto.randomUUID();

/**
 * A template applied to one van (`?apply=<templateId>&container=<id>`): what
 * it should carry, what it has, what is missing — and, from the chosen
 * warehouse, what "Fill from warehouse" would move in one transfer.
 */
export function ApplyTemplateDialog({
  templateId,
  containerId: initialContainer,
  open,
  onOpenChange,
  onContainerChange,
}: {
  templateId: string;
  /** The van to start on; the popup lets another be picked. */
  containerId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keeps the URL's `container` in step with the picker. */
  onContainerChange?: (containerId: string) => void;
}) {
  const { can } = usePermissions();
  const template = useContainerTemplate(templateId, open);
  const locations = useAllLocations(open);
  const fill = useFillFromWarehouse();

  const vans = useMemo(
    () => locations.data.filter((l) => l.type === "container" && l.status !== InventoryStatus.ARCHIVED),
    [locations.data],
  );
  const shops = useMemo(
    () => locations.data.filter((l) => l.type === "warehouse" && l.status !== InventoryStatus.ARCHIVED),
    [locations.data],
  );

  const [containerId, setContainerId] = useState<string | null>(initialContainer);
  const [pickedWarehouse, setPickedWarehouse] = useState<string | null>(null);
  // The primary warehouse when the server marks one, else the first.
  const warehouseId = pickedWarehouse ?? (shops.find((w) => w.isPrimary) ?? shops[0])?.id;

  const diff = useTemplateDiff(templateId, containerId ?? undefined, warehouseId, open);

  // One request id per fill the user means to make: the same for a double
  // click (the server moves stock once for it), a new one whenever the
  // comparison is read again and after a fill went through.
  const [requestId, setRequestId] = useState(newRequestId);
  const [seenDiff, setSeenDiff] = useState(diff.dataUpdatedAt);
  if (seenDiff !== diff.dataUpdatedAt) {
    setSeenDiff(diff.dataUpdatedAt);
    setRequestId(newRequestId());
  }

  // Escape in an open list closes the list, not the popup.
  const [picking, setPicking] = useState<"container" | "warehouse" | null>(null);
  const pickingRef = useRef(picking);
  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);

  const van = vans.find((v) => v.id === containerId) ?? null;
  const shop = shops.find((w) => w.id === warehouseId) ?? null;
  const name = template.data?.name ?? diff.data?.templateName;
  const canFill = can("transfers", "create");
  const summary = diff.data ? diffSummary(diff.data) : null;

  const doFill = () => {
    if (!containerId || !warehouseId || !summary?.willMove) return;
    fill.mutate(
      {
        id: templateId,
        body: { containerId, warehouseId, requestId },
        containerName: van?.name ?? diff.data?.containerName ?? "the van",
      },
      { onSuccess: () => setRequestId(newRequestId()) },
    );
  };

  const containerLabel = useId();
  const warehouseLabel = useId();

  let body: ReactNode;
  if (!containerId) {
    body = <Note>Pick a van to compare with the template.</Note>;
  } else if (diff.isError) {
    body = <Refusal error={diff.error} onRetry={() => diff.refetch()} />;
  } else if (diff.isLoading || !diff.data) {
    body = (
      <div data-testid="apply-loading" className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  } else {
    body = <DiffTable diff={diff.data} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        onEscapeKeyDown={(e) => {
          if (!pickingRef.current) return;
          e.preventDefault();
          setPicking(null);
        }}
      >
        {/* Right padding keeps the title clear of the close button. */}
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle className="text-base">{name ? `Apply ${name}` : "Apply template"}</DialogTitle>
          <DialogDescription className="sr-only">
            Compare a van with the template and fill what is missing from a warehouse.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label id={containerLabel}>Container</Label>
              <LocationPicker
                labelId={containerLabel}
                groups={{ warehouses: [], containers: vans }}
                value={van}
                onChange={(v: StockLocation) => {
                  setContainerId(v.id);
                  setPicking(null);
                  onContainerChange?.(v.id);
                }}
                open={picking === "container"}
                onOpenChange={(o) => setPicking(o ? "container" : null)}
                loading={locations.isLoading}
                placeholder="Pick a container"
                searchPlaceholder="Search containers"
                emptyText="No active containers."
              />
            </div>
            <div className="space-y-1.5">
              <Label id={warehouseLabel}>Warehouse</Label>
              <LocationPicker
                labelId={warehouseLabel}
                groups={{ warehouses: shops, containers: [] }}
                value={shop}
                onChange={(w: StockLocation) => {
                  setPickedWarehouse(w.id);
                  setPicking(null);
                }}
                open={picking === "warehouse"}
                onOpenChange={(o) => setPicking(o ? "warehouse" : null)}
                loading={locations.isLoading}
                placeholder="Pick a warehouse"
                searchPlaceholder="Search warehouses"
                emptyText="No warehouses you can fill from."
              />
            </div>
          </div>

          {body}
        </div>

        <DialogFooter className="m-0 flex-none items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {summary ? summary.text : ""}
            {summary && containerId && !warehouseId ? (
              <span className="block text-xs">No warehouse to fill from.</span>
            ) : null}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {canFill && containerId ? (
              <Button
                className="gap-1.5"
                disabled={!summary?.willMove || !warehouseId || fill.isPending}
                onClick={doFill}
              >
                {fill.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Fill from warehouse
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Every cell clips: under fixed layout one that doesn't spills into the next. */
function DiffTable({ diff }: { diff: ContainerTemplateDiff }) {
  return (
    <TableFrame className="bg-background">
      <Table className="min-w-[44rem] table-fixed">
        <colgroup>
          <col />
          <col className="w-36" />
          <col className="w-20" />
          <col className="w-24" />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-32" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Item</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>On hand</TableHead>
            <TableHead>Missing</TableHead>
            <TableHead>In warehouse</TableHead>
            <TableHead>Will move</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {diff.lines.map((l) => {
            const missing = l.missing > 0;
            // Short: a warehouse was asked, and it can't cover what is missing.
            const short = missing && l.willMove !== undefined && l.willMove < l.missing;
            return (
              <TableRow key={l.productId} data-missing={missing ? "true" : "false"}>
                <TableCell className="truncate font-medium" title={l.productName}>
                  {l.productName}
                </TableCell>
                <TableCell className="truncate font-mono text-xs">{l.sku || "—"}</TableCell>
                <TableCell className="truncate tabular-nums">{l.target}</TableCell>
                <TableCell className="truncate tabular-nums">{l.onHand}</TableCell>
                <TableCell
                  className={cn(
                    "truncate tabular-nums",
                    missing ? "font-semibold text-amber-600 dark:text-amber-500" : "text-muted-foreground",
                  )}
                >
                  {l.missing}
                </TableCell>
                <TableCell className="truncate tabular-nums">{l.available ?? "—"}</TableCell>
                <TableCell className="overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">{l.willMove ?? "—"}</span>
                    {short ? (
                      <Badge
                        variant="outline"
                        className="flex-none border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
                      >
                        short
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableFrame>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">{children}</p>
  );
}

/** A refusal, in words: the van or warehouse is out of the caller's reach, or gone. */
function Refusal({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof ApiError ? error.status : 0;
  const text =
    status === 403
      ? "You don't have access to this van or warehouse."
      : status === 404
        ? "The template, van or warehouse no longer exists."
        : "Couldn't compare the van with the template.";
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="text-sm font-medium">{text}</div>
      {status !== 403 && status !== 404 ? (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
