import { TransferType } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { transferTypeLabel, isAutoType } from "../lib";

/**
 * Workiz's Tag-module colours (main.css: success #3acf7d, primary #3589e9,
 * denied #f45e44, pending #f5ba45, archived #9ea6aa) — the tags it prints on
 * its inventory rows ("Low stock") and statuses.
 */
const TONE: Record<TransferType, string> = {
  [TransferType.RECEIVE]: "bg-[#3acf7d]",
  [TransferType.TRANSFER]: "bg-[#3589e9]",
  [TransferType.DEDUCT]: "bg-[#f45e44]",
  [TransferType.RESTORE]: "bg-[#f5ba45]",
  [TransferType.RETURN]: "bg-[#9ea6aa]",
};

/** A movement's type as a Workiz Tag: 4px corners, 0 4px, white 14px/16px words. */
export function TransferTypeBadge({ type }: { type: TransferType }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-flex rounded-[4px] px-1 text-sm leading-4 text-white", TONE[type])}>
        {transferTypeLabel(type)}
      </span>
      {isAutoType(type) ? (
        // Tag-module__default: white with a 1px #c4c4c4 edge.
        <span className="inline-flex rounded-[4px] border border-wz-tab-rule bg-background px-1 text-xs leading-4 text-wz-strong">
          auto
        </span>
      ) : null}
    </span>
  );
}
