"use client";

import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSoftphoneStore, type SoftphoneStatus } from "../softphone-store";

const STATUS_DOT: Record<SoftphoneStatus, string> = {
  offline: "bg-muted-foreground/40",
  connecting: "bg-amber-500 animate-pulse",
  online: "bg-emerald-500",
  error: "bg-red-500",
};

const STATUS_LABEL: Record<SoftphoneStatus, string> = {
  offline: "off",
  connecting: "connecting…",
  online: "online",
  error: "error",
};

/** Single header button: opens the dialer. A dot shows the phone status. */
export function SoftphoneControls() {
  const status = useSoftphoneStore((s) => s.status);
  const setDialerOpen = useSoftphoneStore((s) => s.setDialerOpen);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          onClick={() => setDialerOpen(true)}
          aria-label="Open phone"
        >
          <Phone className="size-4" />
          <span
            className={cn(
              "absolute right-1 top-1 size-2 rounded-full ring-2 ring-background",
              STATUS_DOT[status],
            )}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Phone — {STATUS_LABEL[status]}</TooltipContent>
    </Tooltip>
  );
}
