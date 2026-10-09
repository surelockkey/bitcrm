"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WZ_MENU_POPUP, WZ_MENU_POPUP_ITEM } from "@/components/workiz/menu-popup";
import { cn } from "@/lib/utils";

/** Oldest first — "Estimate 1" is the first one made, as in Workiz. */
export function byCreated<T extends { createdAt: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** What Workiz calls an estimate in its tabs and its list: the name it was given, or "Estimate N". */
export const optionLabel = (e: { name?: string | null }, index: number): string => e.name?.trim() || `Estimate ${index + 1}`;

/** Workiz's tab words (EditableTabs under estimatesHeader): 16px/500 ink, 0.225px tracking. */
const WORDS = "text-[16px] leading-[25px] font-medium tracking-[0.225px]";

/**
 * The job's estimates as Workiz's tabs on an estimate's page
 * (pg_estimate_wz_01_job): "Grade 3 · Grade 2 · Grade 1 · Add estimate" — each
 * a link to that estimate's page, 25px either side (no gap between), the open
 * one carrying a 4px round-ended #3e4b51 bar 28px under its top; the names
 * stop at 162px. As in Workiz the open tab is where the estimate is renamed
 * (`onRename`: the pencil that shows over it, then a box in its place; Enter
 * or leaving saves, Escape keeps the name). "Add estimate" is Workiz's blue
 * words opening New estimate / Make a copy.
 */
export function EstimateTabs({
  estimates,
  currentId,
  canCreate,
  onNew,
  onCopy,
  copying,
  onRename,
}: {
  estimates: readonly { id: string; name?: string | null; createdAt: string }[];
  currentId: string;
  canCreate: boolean;
  onNew: () => void;
  /** Make a copy of the open estimate. */
  onCopy?: () => void;
  copying?: boolean;
  /** Rename the open estimate (given to whoever may edit it). */
  onRename?: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Enter / Escape close the box themselves; the blur its removal may fire must not save again.
  const done = useRef(false);
  const current = estimates.find((e) => e.id === currentId);

  const finish = (save: boolean) => {
    if (done.current || draft === null) return;
    done.current = true;
    const next = draft.trim();
    if (save && onRename && next !== (current?.name?.trim() ?? "")) onRename(next);
    setDraft(null);
  };

  return (
    <div className="flex min-w-0 items-start">
      <div
        role="tablist"
        aria-label="Estimates"
        className="flex h-8 min-w-0 items-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {estimates.map((e, i) => {
          const selected = e.id === currentId;
          const label = optionLabel(e, i);
          return (
            <div key={e.id} className="group/tab relative flex shrink-0 flex-col px-[25px]">
              {selected && draft !== null ? (
                <input
                  aria-label="Estimate name"
                  autoFocus
                  value={draft}
                  maxLength={120}
                  placeholder={label}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onBlur={() => finish(true)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      finish(true);
                    } else if (ev.key === "Escape") {
                      ev.preventDefault();
                      finish(false);
                    }
                  }}
                  className={cn(WORDS, "h-[25px] w-[120px] border-0 bg-transparent p-0 text-foreground outline-none")}
                />
              ) : (
                <Link
                  href={`/estimates/${e.id}`}
                  role="tab"
                  aria-selected={selected}
                  className={cn(WORDS, "block max-w-[162px] truncate text-foreground outline-none focus-visible:underline")}
                >
                  {label}
                </Link>
              )}
              {selected ? <span aria-hidden className="absolute top-7 left-0 h-1 w-full rounded-[50px] bg-wz-tab-bar" /> : null}
              {selected && onRename && draft === null ? (
                <button
                  type="button"
                  aria-label="Rename estimate"
                  onClick={() => {
                    done.current = false;
                    setDraft(current?.name?.trim() ?? "");
                  }}
                  className="absolute top-1 right-1 grid size-4 place-items-center text-foreground opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"
                >
                  <Pencil className="size-[13px]" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {canCreate ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(WORDS, "ml-[15px] shrink-0 text-wz-link outline-none hover:underline focus-visible:underline")}>
              Add estimate
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} className={WZ_MENU_POPUP}>
            <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={onNew}>
              New estimate
            </DropdownMenuItem>
            {onCopy ? (
              <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} disabled={copying} onSelect={onCopy}>
                Make a copy
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
