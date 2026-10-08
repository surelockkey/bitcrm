import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface WzTagFilterTag {
  id: string;
  name: string;
  /** The tag's own fill, a background utility (`tagSolidClasses(tag.color)`). */
  className: string;
}

/**
 * The legacy reports' tag cloud (`.tagFilters`, Job Statistics:
 * rep_jobstats_wz_02_overview_day, _14_tag_selected): every tag of the
 * account, in catalog order, as an 11px/16px medium capital chip — 4px 8px,
 * radius 3, white on the tag's colour — 4px apart, rows 33px apart. A click
 * filters by it (any of the chosen tags) and paints it rgba(0,0,0,.75); a
 * second click lets it go. `after` sits on the cloud's last line, as the
 * Sources tab's "All sources" select does.
 */
export function WzTagFilter({
  tags,
  selected,
  onToggle,
  after,
  className,
}: {
  tags: readonly WzTagFilterTag[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  after?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Tags"
      className={cn("flex flex-wrap items-start", className)}
    >
      {tags.map((t) => {
        const on = selected.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(t.id)}
            className={cn(
              "mt-[9px] mr-1 cursor-pointer rounded-[3px] px-2 py-1 text-[11px] leading-4 font-medium tracking-[0.4px] whitespace-nowrap text-white uppercase outline-none",
              "focus-visible:ring-2 focus-visible:ring-wz-focus",
              on ? "bg-black/75" : t.className,
            )}
          >
            {t.name}
          </button>
        );
      })}
      {after}
    </div>
  );
}
