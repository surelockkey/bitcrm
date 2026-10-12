import { CircleCheck } from "lucide-react";
import { isClientConfirmationCurrent, type Deal } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatStamp } from "../lib";

type Confirmable = Pick<Deal, "clientConfirmedAt" | "clientConfirmedFor" | "scheduledDate" | "scheduledTimeSlot" | "allDay">;

/**
 * "Confirmed by client · Oct 12, 3:05 PM" — the client tapped Confirm on the
 * page their `{{confirm_link}}` opens (B12, Workiz `client_confirmed`). Shown
 * only while the confirmation is for the visit the job has NOW: once the job
 * is moved, the client has not confirmed the new time. Green as Workiz's own
 * "appointment confirmed" tag (#198218 = the success token).
 */
export function ClientConfirmedBadge({ deal, now, className }: { deal: Confirmable; now?: Date; className?: string }) {
  if (!isClientConfirmationCurrent(deal) || !deal.clientConfirmedAt) return null;
  return (
    <span
      title="The client confirmed this visit through the confirm link"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-chip border border-success/30 bg-success/10 px-2 py-0.5 text-[12px] leading-[18px] font-medium text-success-text",
        className,
      )}
    >
      <CircleCheck className="size-3.5" aria-hidden />
      Confirmed by client · {formatStamp(deal.clientConfirmedAt, now)}
    </span>
  );
}

/** The jobs list's "Confirmed" cell: the moment, with the check; a dash when the visit is not confirmed. */
export function ClientConfirmedCell({ deal, now }: { deal: Confirmable; now?: Date }) {
  if (!isClientConfirmationCurrent(deal) || !deal.clientConfirmedAt) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-success-text">
      <CircleCheck className="size-3.5" role="img" aria-label="Confirmed by client" />
      {formatStamp(deal.clientConfirmedAt, now)}
    </span>
  );
}
