import { TriangleAlert } from "lucide-react";
import { DealStage } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { stageLabel, stageTone } from "../lib";

const TONE: Record<string, string> = {
  submitted: "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/50 dark:border-blue-900",
  progress: "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/50 dark:border-amber-900/70",
  pending: "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/50 dark:border-violet-900",
  closed: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-900",
  canceled: "text-muted-foreground bg-muted border-border",
};

export function StageBadge({ stage, className }: { stage: DealStage; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        TONE[stageTone(stage)],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {stageLabel(stage)}
    </span>
  );
}

export function PriorityFlag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
        className,
      )}
    >
      <TriangleAlert className="size-2.5" /> Urgent
    </span>
  );
}
