"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type SyncMode = "replace" | "append";

const OPTIONS: Array<{ value: SyncMode; label: string }> = [
  { value: "replace", label: "Replace existing job items" },
  { value: "append", label: "Add to existing job items" },
];

/**
 * Workiz's question when an estimate is synced to a job that already has
 * items: "This job already has items. Please select how you want to proceed"
 * — Replace existing job items (the default) or Add to existing job items —
 * then Cancel / Continue.
 */
export function SyncToJobDialog({
  open,
  onOpenChange,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (mode: SyncMode) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <Body onCancel={() => onOpenChange(false)} onContinue={onContinue} /> : null}
    </Dialog>
  );
}

function Body({ onCancel, onContinue }: { onCancel: () => void; onContinue: (mode: SyncMode) => void }) {
  const [mode, setMode] = useState<SyncMode>("replace");
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="text-xl">This job already has items.</DialogTitle>
        <DialogDescription className="text-foreground">Please select how you want to proceed:</DialogDescription>
      </DialogHeader>
      <fieldset className="space-y-4 py-2">
        <legend className="sr-only">How to sync</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-3 text-[15px]">
            <input
              type="radio"
              name="sync-mode"
              value={o.value}
              checked={mode === o.value}
              onChange={() => setMode(o.value)}
              className="size-4 cursor-pointer accent-brand"
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <DialogFooter className="gap-3">
        <Button type="button" variant="outline" size="lg" className="h-10 rounded-pill px-8" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="lg" className="h-10 rounded-pill px-8 font-semibold" onClick={() => onContinue(mode)}>
          Continue
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
