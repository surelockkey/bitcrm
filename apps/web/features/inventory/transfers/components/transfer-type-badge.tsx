import { TransferType } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { transferTypeLabel, isAutoType } from "../lib";

const TONE: Record<TransferType, string> = {
  [TransferType.RECEIVE]: "border-green-500/26 bg-green-500/10 text-green-700 dark:text-green-500",
  [TransferType.TRANSFER]: "border-brand/22 bg-brand/10 text-brand",
  [TransferType.DEDUCT]: "border-destructive/22 bg-destructive/10 text-destructive",
  [TransferType.RESTORE]: "border-amber-500/24 bg-amber-500/10 text-amber-700 dark:text-amber-500",
};

export function TransferTypeBadge({ type }: { type: TransferType }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
          TONE[type],
        )}
      >
        {transferTypeLabel(type)}
      </span>
      {isAutoType(type) ? (
        <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">auto</span>
      ) : null}
    </span>
  );
}
