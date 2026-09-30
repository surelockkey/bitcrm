"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllLocations, locationStockQuery } from "@/features/inventory/stock/hooks";
import { LocationPicker } from "@/features/inventory/stock/components/location-picker";
import type { StockLocation } from "@/features/inventory/stock/lib";
import { MAX_TEMPLATE_LINES, linesFromStock, type CopyMode, type DraftLine } from "../lib";

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * "Copy from location": the template's lines from what a warehouse or a van
 * holds now — each product there, its quantity as the target. The owner's use:
 * after an import, make the template from the store in one go.
 *
 * The stock is `GET /inventory/stock/locations/:type/:id`, one request. A
 * template that already has lines asks what to do with them: Replace them
 * with the location's, or Merge — keep them and add the products they lack.
 */
export function CopyFromLocationDialog({
  open,
  onOpenChange,
  current,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template's lines as they are in the form. */
  current: DraftLine[];
  onCopy: (lines: DraftLine[], mode: CopyMode) => void;
}) {
  const labelId = useId();
  const [picking, setPicking] = useState(false);
  const [location, setLocation] = useState<StockLocation | null>(null);

  const locations = useAllLocations(open);
  const groups = useMemo(() => {
    const live = locations.data.filter((l) => l.status !== InventoryStatus.ARCHIVED);
    return {
      warehouses: live.filter((l) => l.type === "warehouse"),
      containers: live.filter((l) => l.type === "container"),
    };
  }, [locations.data]);

  const stock = useQuery({
    ...locationStockQuery(location?.type ?? "warehouse", location?.id ?? ""),
    enabled: open && !!location,
  });
  const copied = useMemo(() => (stock.data ? linesFromStock(stock.data.rows) : null), [stock.data]);
  const units = copied ? copied.lines.reduce((n, l) => n + Number(l.quantity), 0) : 0;
  const have = useMemo(() => new Set(current.map((l) => l.productId)), [current]);
  const added = copied ? copied.lines.filter((l) => !have.has(l.productId)).length : 0;

  const ready = !!copied && copied.lines.length > 0;
  const result = (mode: CopyMode) =>
    !copied ? 0 : mode === "replace" ? copied.lines.length : current.length + added;
  const tooMany = ready && result(current.length > 0 ? "merge" : "replace") > MAX_TEMPLATE_LINES;

  const copy = (mode: CopyMode) => {
    if (!copied) return;
    onCopy(copied.lines, mode);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        // Escape closes the location list first, not the popup under it.
        onEscapeKeyDown={(e) => {
          if (picking) {
            e.preventDefault();
            setPicking(false);
          }
        }}
      >
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Copy from location</DialogTitle>
          <DialogDescription>
            Fill the template from what a warehouse or a van holds now — each product there, its quantity as the target.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <Label id={labelId}>Location</Label>
            <LocationPicker
              labelId={labelId}
              groups={groups}
              value={location}
              onChange={(l) => {
                setLocation(l);
                setPicking(false);
              }}
              open={picking}
              onOpenChange={setPicking}
              loading={locations.isLoading}
              placeholder="Pick a warehouse or a van"
              emptyText="No locations."
            />
          </div>

          {location ? (
            <div data-testid="copy-summary" className="min-h-16 space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
              {stock.isLoading ? (
                <>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </>
              ) : stock.isError ? (
                <p className="text-destructive">Couldn&apos;t read what {location.name} holds.</p>
              ) : copied && copied.lines.length === 0 ? (
                <p className="text-muted-foreground">{location.name} holds nothing to copy.</p>
              ) : copied ? (
                <>
                  <p>
                    <span className="font-medium">{location.name}</span> holds{" "}
                    {plural(copied.lines.length, "product")}, {plural(units, "unit")}.
                  </p>
                  {copied.skipped > 0 ? (
                    <p className="text-muted-foreground">
                      {plural(copied.skipped, "row")} left out — the item is no longer in the catalog.
                    </p>
                  ) : null}
                  {current.length > 0 ? (
                    <p className="text-muted-foreground">
                      This template has {plural(current.length, "line")}. <b>Replace</b> them with the
                      location&apos;s, or <b>Merge</b> — keep them and add the {plural(added, "product")} they lack.
                    </p>
                  ) : null}
                  {tooMany ? (
                    <p className="flex gap-1.5 text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="mt-0.5 size-4 flex-none" />
                      A template holds {MAX_TEMPLATE_LINES} products at most — remove some before saving.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t px-4 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {current.length > 0 ? (
            <>
              <Button type="button" variant="outline" disabled={!ready} onClick={() => copy("merge")}>
                Merge
              </Button>
              <Button type="button" disabled={!ready} onClick={() => copy("replace")}>
                Replace
              </Button>
            </>
          ) : (
            <Button type="button" disabled={!ready} onClick={() => copy("replace")}>
              {ready ? `Copy ${plural(copied!.lines.length, "product")}` : "Copy"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
