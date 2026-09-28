import { cn } from "@/lib/utils";

/** On / Off for two-step sign-in, readable at a glance: green when on, grey when off. */
export function TwoStepStatus({ enabled }: { enabled: boolean }) {
  return (
    <span
      data-testid="two-step-status"
      className={cn(
        "inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        enabled
          ? "bg-green-500/15 text-green-700 dark:text-green-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      {enabled ? "On" : "Off"}
    </span>
  );
}
