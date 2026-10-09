"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WzEditIcon, WzStockIcon } from "@/components/workiz/icons";
import { RowIconAction } from "./row-icon-action";

/**
 * The pieces of Workiz's Locations tab (pg_inventory_wz_02_locations) that
 * Warehouses and Containers — Workiz's Locations, split — share: the band
 * with the yellow Add New 16px under the tab rule and 16px from the right
 * (73px down to the strip), the Name cell (cut with "…"), and the row's
 * Actions — edit.svg and inventory_new.svg 15px apart.
 */
export function LocationsBand({
  addLabel = "Add New",
  canAdd,
  pending,
  onAdd,
  children,
}: {
  addLabel?: string;
  /** The reader may add one (or the permissions are not known yet). */
  canAdd: boolean;
  /** The permissions are loading: in place, off. */
  pending: boolean;
  onAdd: () => void;
  /** Anything of BitCRM's own, left of Add New. */
  children?: ReactNode;
}) {
  return (
    <div data-testid="locations-band" className="flex h-[73px] shrink-0 items-start justify-end gap-4 px-4 pt-4">
      {children}
      {canAdd ? (
        <Button disabled={pending} onClick={onAdd}>
          <Plus />
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** inventory-module__productName: one line, cut with "…" — the whole name on hover. */
export function LocationName({ name, archived = false }: { name: string; archived?: boolean }) {
  return (
    <span className="block truncate" title={name}>
      {name}
      {archived ? <span className="text-wz-outline-label"> (archived)</span> : null}
    </span>
  );
}

/** The row's Actions (inventory-module__actionsWrapper): Edit and Stock, 15px apart. */
export function LocationActions({
  name,
  onEdit,
  onStock,
}: {
  name: string;
  onEdit: () => void;
  onStock: () => void;
}) {
  return (
    // The popups these open sit over the row; their clicks must not reach it.
    <div className="flex items-center gap-[15px]" onClick={(e) => e.stopPropagation()}>
      <RowIconAction label={`Edit ${name}`} tip="Edit" onClick={onEdit}>
        <WzEditIcon />
      </RowIconAction>
      <RowIconAction label={`Stock in ${name}`} tip="Stock" onClick={onStock}>
        <WzStockIcon />
      </RowIconAction>
    </div>
  );
}
