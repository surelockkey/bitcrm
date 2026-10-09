"use client";

import { useState } from "react";
import { WzMoveItemIcon, WzPlusBiggerIcon, WzReturnIcon } from "@/components/workiz/icons";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import type { StockTarget } from "../lib";
import { AddStockDialog, MoveStockDialog, ReturnStockDialog } from "./stock-action-dialogs";

type Action = "add" | "move" | "return";

/**
 * Workiz's per-row stock glyphs (stockModal-module__stockActionsWrapper: 24px,
 * 16px apart, centred, lighter under the cursor): ＋ "Add items", the box
 * "Move items", ↺ "Return items". The same row works in an item's popup (one
 * row per location) and in a location's popup (one row per item,
 * `allowAdd={false}` — stock only arrives from the Inventory tab). An
 * archived location takes no new stock — it isn't a transfer target either —
 * but what it still holds can be moved or returned.
 *
 * The caller decides who sees it at all (`transfers.create`).
 */
export function StockRowActions({
  target,
  allowAdd = true,
  archived = false,
  align = "center",
}: {
  target: StockTarget;
  allowAdd?: boolean;
  archived?: boolean;
  /** `start`: the location popup's grid, whose cells sit at the left. */
  align?: "center" | "start";
}) {
  const [action, setAction] = useState<Action | null>(null);
  const empty = target.available <= 0;
  const item = target.product.name;
  const here = target.location.name;
  const close = (open: boolean) => (open ? undefined : setAction(null));

  return (
    <div className={align === "center" ? "flex items-center justify-center gap-4" : "flex items-center gap-4"}>
      {allowAdd ? (
        <RowIconAction label={`Add ${item} to ${here}`} tip="Add items" disabled={archived} onClick={() => setAction("add")}>
          <WzPlusBiggerIcon />
        </RowIconAction>
      ) : null}
      <RowIconAction label={`Move ${item} from ${here}`} tip="Move items" disabled={empty} onClick={() => setAction("move")}>
        <WzMoveItemIcon />
      </RowIconAction>
      <RowIconAction label={`Return ${item} from ${here}`} tip="Return items" disabled={empty} onClick={() => setAction("return")}>
        <WzReturnIcon />
      </RowIconAction>

      {/* Mounted only while open, so each opening starts from a clean form. */}
      {action === "add" ? <AddStockDialog target={target} open onOpenChange={close} /> : null}
      {action === "move" ? <MoveStockDialog target={target} open onOpenChange={close} /> : null}
      {action === "return" ? <ReturnStockDialog target={target} open onOpenChange={close} /> : null}
    </div>
  );
}
