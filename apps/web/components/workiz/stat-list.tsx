import { cn } from "@/lib/utils";

export interface WzStat {
  key: string;
  /** Already printed, as the page wants it ("296", "133,524.60"). */
  value: string;
  /** The two caption lines beside the figure: ["Jobs", "Done"]. */
  caption: readonly [string, string];
}

/**
 * The legacy pages' KPI column (`ul.stats`, Job Statistics:
 * rep_jobstats_wz_02_overview_day): rows of 72px — 19px above, 20px below,
 * a 1px rgba(0,0,0,.25) rule between them — each a 48px/48px light ink
 * figure with its caption on two 16px lines 10px to its right, the figure
 * 7px higher than the caption. The figure's float hangs past its row's
 * words into the 20px under them, as Workiz's does, so a row stays 72px.
 */
export function WzStatList({
  items,
  className,
  "aria-label": ariaLabel,
}: {
  items: readonly WzStat[];
  className?: string;
  "aria-label": string;
}) {
  return (
    <ul aria-label={ariaLabel} className={cn("list-none", className)}>
      {items.map((s, i) => (
        <li
          key={s.key}
          className={cn(
            "pt-[19px] pb-5 pr-[5px] text-base leading-4 text-foreground",
            i > 0 && "border-t border-black/25",
          )}
        >
          <strong className="float-left -mt-[7px] mr-2.5 text-[48px] leading-[48px] font-light tracking-[0.4px] tabular-nums">
            {s.value}
          </strong>
          {/* One name for a screen reader, two lines on screen. */}
          <span className="block">
            <span className="sr-only">{`${s.caption[0]} ${s.caption[1]}`}</span>
            <span aria-hidden className="block">
              {s.caption[0]}
            </span>
            <span aria-hidden className="block">
              {s.caption[1]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
