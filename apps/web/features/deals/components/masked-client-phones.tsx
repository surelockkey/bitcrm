"use client";

import { EyeOff } from "lucide-react";
import { CallClientButton } from "@/features/telephony/components/call-client-button";

/**
 * The client's phones for somebody who may not see them.
 *
 * A masked viewer gets `phones: []` with a `phoneCount`, so any UI that renders
 * its call button *inside* a loop over `phones` shows them nothing at all —
 * they learn a number exists and have no way to ring it, which is worse than
 * not masking, because their only route back is to phone the office.
 *
 * So the count drives the rows instead. One row per withheld number, each with
 * its own call button carrying the `phoneIndex` the server will resolve. The
 * technician can still choose the mobile over the landline; they just never
 * learn which digits either one is.
 */
export function MaskedClientPhones({
  phoneCount,
  dealId,
  contactId,
  className,
}: {
  phoneCount: number;
  dealId: string;
  contactId: string;
  className?: string;
}) {
  if (!phoneCount) return null;

  return (
    <div className={className}>
      {Array.from({ length: phoneCount }, (_, i) => (
        // Given as a card rather than a line of grey text: with the digits
        // withheld there is nothing else on this row to act on, so the call is
        // the row's whole purpose and gets the room to say so.
        <div
          key={i}
          className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <EyeOff className="size-3.5 shrink-0" />
            <span className="truncate text-sm">
              {phoneCount === 1
                ? "Number hidden"
                : `Number ${i + 1} of ${phoneCount}, hidden`}
              {i === 0 && phoneCount > 1 ? " · primary" : ""}
            </span>
          </span>
          {/* `to` is empty on purpose — the button sends a handle, and the
              server resolves the digits. */}
          <CallClientButton
            to=""
            dealId={dealId}
            contactId={contactId}
            phoneIndex={i}
            variant="prominent"
          />
        </div>
      ))}
    </div>
  );
}
