"use client";

import { useState, type ReactNode } from "react";
import { Package, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StockTarget } from "../lib";
import { AddStockDialog, MoveStockDialog, ReturnStockDialog } from "./stock-action-dialogs";

type Action = "add" | "move" | "return";

/**
 * Workiz's per-row stock icons: ＋ add, box move, ↺ return. The same row
 * works in an item's popup (one row per location) and in a location's popup
 * (one row per item, `allowAdd={false}` — stock only arrives from Items).
 * An archived location takes no new stock — it isn't a transfer target
 * either — but what it still holds can be moved or returned.
 *
 * The caller decides who sees it at all (`transfers.create`).
 */
export function StockRowActions({
  target,
  allowAdd = true,
  archived = false,
}: {
  target: StockTarget;
  allowAdd?: boolean;
  archived?: boolean;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const empty = target.available <= 0;
  const item = target.product.name;
  const here = target.location.name;
  const close = (open: boolean) => (open ? undefined : setAction(null));

  return (
    <div className="flex items-center gap-0.5">
      {allowAdd ? (
        <IconAction
          label={`Add ${item} to ${here}`}
          tip="Add stock"
          disabled={archived}
          onClick={() => setAction("add")}
        >
          <Plus />
        </IconAction>
      ) : null}
      <IconAction
        label={`Move ${item} from ${here}`}
        tip="Move"
        disabled={empty}
        onClick={() => setAction("move")}
      >
        <Package />
      </IconAction>
      <IconAction
        label={`Return ${item} from ${here}`}
        tip="Return"
        disabled={empty}
        onClick={() => setAction("return")}
      >
        <RotateCcw />
      </IconAction>

      {/* Mounted only while open, so each opening starts from a clean form. */}
      {action === "add" ? <AddStockDialog target={target} open onOpenChange={close} /> : null}
      {action === "move" ? <MoveStockDialog target={target} open onOpenChange={close} /> : null}
      {action === "return" ? <ReturnStockDialog target={target} open onOpenChange={close} /> : null}
    </div>
  );
}

function IconAction({
  label,
  tip,
  disabled,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
