"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { MessageStatus } from "@bitcrm/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, statusTick } from "../lib";
import { WzMessageReceivedIcon } from "./inbox-icons";

/**
 * The delivery tick under an outbound bubble — one grey tick for sent, two
 * for delivered, two coloured for read, a spinner while queued / sending,
 * and a red alert mark with the carrier's reason when it did not arrive.
 */
export function StatusTicks({
  status,
  errorCode,
  errorMessage,
  className,
}: {
  status: MessageStatus;
  errorCode?: string;
  errorMessage?: string;
  className?: string;
}) {
  const tick = statusTick(status);
  const label =
    tick === "error"
      ? [STATUS_LABEL[status], errorMessage ?? (errorCode ? `Error ${errorCode}` : undefined)]
          .filter(Boolean)
          .join(" · ")
      : STATUS_LABEL[status];

  // Delivered is Workiz's own double tick (`msg_received.svg`, 16px #768287);
  // read is the same in the link blue; the rest are ours.
  const icon =
    tick === "pending" ? (
      <Loader2 className="size-3 animate-spin" />
    ) : tick === "sent" ? (
      <Check className="size-3.5 text-wz-outline-label" strokeWidth={1.5} />
    ) : tick === "delivered" ? (
      <WzMessageReceivedIcon className="text-wz-outline-label" />
    ) : tick === "read" ? (
      <WzMessageReceivedIcon className="text-brand" />
    ) : (
      <AlertCircle className="size-3.5 text-wz-danger" strokeWidth={1.5} />
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          data-tick={tick}
          className={cn("inline-flex items-center text-wz-text", className)}
        >
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
