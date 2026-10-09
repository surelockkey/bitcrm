"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { canBlockNumber } from "@/features/telephony/blocked-callers";
import { BlockNumberDialog } from "@/features/telephony/components/block-number-dialog";
import { callParty, type CallRecord } from "../lib";

/**
 * "Block this number" on a call — its side panel in the log and its own page:
 * opens Workiz's "Block a Number" form with the other side's number filled
 * in, so a dispatcher ends a spam call's career from the call itself. Only
 * with `calls.block`, and only for an outside number the viewer can see.
 *
 * The other side is the caller of an inbound call and the dialled number of
 * an outbound one — by direction, not by who the backend resolved, so our
 * own unresolved number on an outbound call is never the one offered.
 */
export function BlockCallerButton({ call, className }: { call: CallRecord; className?: string }) {
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const party = callParty(call, call.direction === "outbound" ? "to" : "from");

  if (!can("calls", "block") || !canBlockNumber(party)) return null;

  return (
    <>
      <Button type="button" variant="outline" size="sm" className={cn("gap-1.5", className)} onClick={() => setOpen(true)}>
        <Ban className="size-3.5" /> Block this number
      </Button>
      {/* Mounted only while open: the form's mutation hook needs the query
          client, which a call row drawn on its own (tests, previews) lacks. */}
      {open ? <BlockNumberDialog open onOpenChange={setOpen} initialNumber={party.number} /> : null}
    </>
  );
}
