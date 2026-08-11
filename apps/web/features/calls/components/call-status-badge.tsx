"use client";

import { cn } from "@/lib/utils";
import { STATUS_LABEL, statusTone, type CallStatus } from "../lib";

const TONE_CLASSES: Record<ReturnType<typeof statusTone>, string> = {
  live: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  neutral: "bg-muted text-muted-foreground",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function CallStatusBadge({ status }: { status?: CallStatus }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
      )}
    >
      {tone === "live" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
      ) : null}
      {status ? STATUS_LABEL[status] : "Unknown"}
    </span>
  );
}
