"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useConversations, useInboxCounters } from "../hooks";
import {
  categoryCount,
  categoryOf,
  categoryState,
  categoryTooltip,
  flattenConversations,
  formatCategoryCount,
  INBOX_CATEGORIES,
  type CategoryCount,
  type InboxCategory,
  type ListState,
} from "../lib";
import {
  WzAllIcon,
  WzArchiveIcon,
  WzCategoriesMenuIcon,
  WzClientsIcon,
  WzRequestsIcon,
  WzTeamIcon,
} from "./inbox-icons";

/** The glyph each category gets when the column is folded to a rail (Workiz 08, its own SVGs). */
const CATEGORY_ICON: Record<InboxCategory, typeof WzAllIcon> = {
  all: WzAllIcon,
  requests: WzRequestsIcon,
  clients: WzClientsIcon,
  team: WzTeamIcon,
  archived: WzArchiveIcon,
};

const STORAGE_KEY = "bitcrm.inbox.categories-collapsed";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const readCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // private mode, blocked storage — stays open
  }
};

/** Folded or open, remembered per browser. The server snapshot is "open", so hydration agrees. */
export function useCategoriesCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const toggle = useCallback(() => {
    const next = !readCollapsed();
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  }, []);
  return [collapsed, toggle];
}

/** Workiz's IconButton large/white: 40×40, r8, #f3f6f7 under the pointer, the glyph at 24px in ink. */
const railButton =
  "relative grid size-10 shrink-0 place-items-center rounded-[8px] text-foreground transition-colors hover:bg-wz-secondary-hover";

/**
 * The left column of the Workiz Inbox: "Messages", a collapse toggle, and
 * the categories — All, Requests, Clients, Team, Archived — each with the
 * TOTAL number of conversations in it on the right and a red dot while
 * something in it is unread (reference 01: "All 42657", "Clients 42423 •").
 * The unread number itself lives in the tooltip. The selected one is
 * highlighted; folded, it is a rail of icons with the same dots
 * (reference 08).
 *
 * Until `POST /internal/counters/recount` has rebuilt the totals, the API
 * reports none, and the open category falls back to the rows the list has
 * actually loaded, marked "42+" — see `categoryCount`. It never prints a
 * bare 0 for a category it cannot count.
 */
export function InboxCategories({
  state,
  onStateChange,
  collapsed,
  onToggleCollapsed,
  countsShown = true,
  className,
}: {
  state: ListState;
  onStateChange: (next: ListState) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /**
   * Whether the numbers and the unread dots may be drawn. The inbox holds
   * them until the rows are in too, so all of it lands in one frame — a
   * number arriving on its own pushed its dot aside. Their room stays held.
   */
  countsShown?: boolean;
  className?: string;
}) {
  const { data: counters } = useInboxCounters();
  const active = categoryOf(state);
  const pick = (cat: InboxCategory) => onStateChange({ ...state, ...categoryState(cat, state) });

  // The same query key the conversation list uses, so this reads its cache
  // rather than issuing a second request. Only the open category has rows,
  // which is exactly the one whose fallback number we can honestly show.
  const listFilter = useMemo(
    () => ({ view: state.view, kind: state.view === "all" ? state.kind : undefined }),
    [state.view, state.kind],
  );
  const listed = useConversations(listFilter);
  const loadedInActive = useMemo(
    () => (listed.data ? flattenConversations(listed.data.pages).length : undefined),
    [listed.data],
  );
  const countOf = (cat: InboxCategory): CategoryCount =>
    categoryCount(cat, counters, cat === active ? loadedInActive : undefined);

  if (collapsed) {
    // Workiz folded (`categories__collapsedCategoriesContainer`): a 60px rail
    // ruled #cad3d6 on the right; the fold button 12px in; each category a
    // 40×56 cell, 8px apart, #f3f6f7 when open or hovered, its dot at 6/8.
    return (
      <nav
        aria-label="Categories"
        data-collapsed="true"
        className={cn("flex w-[61px] shrink-0 flex-col border-r border-wz-rule bg-background", className)}
      >
        <div className="flex h-[58px] shrink-0 items-start pl-3 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Expand categories"
                aria-expanded={false}
                className={railButton}
              >
                <WzCategoriesMenuIcon />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand menu</TooltipContent>
          </Tooltip>
        </div>

        <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-2 pb-[13px] pl-3 pr-2 pt-[13px]">
          {INBOX_CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICON[cat.value];
            const selected = active === cat.value;
            const count = countOf(cat.value);
            return (
              <Tooltip key={cat.value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-label={cat.label}
                    onClick={() => pick(cat.value)}
                    className={cn(
                      "relative grid h-14 w-10 place-items-center rounded-[4px] text-foreground transition-colors hover:bg-wz-secondary-hover",
                      selected && "bg-wz-secondary-hover",
                    )}
                  >
                    <Icon />
                    {count.unread && countsShown ? (
                      <span
                        data-testid="unread-dot"
                        aria-hidden
                        className="absolute right-2 top-[6px] size-2 rounded-full bg-wz-danger"
                      />
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{categoryTooltip(cat.label, count)}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    );
  }

  // Workiz open (`categories__categoriesContainer`, pg_messages_wz_01_list):
  // 200px + a #cad3d6 rule; a 58px head ruled under ("Messages" 18px/27px 600,
  // the fold button 16px from the edge); the categories 13px/8px in, 37px
  // tall, 13px/19px — the open one #f3f6f7 and semibold, its count too; the
  // others' counts regular; an 8px #f45e44 dot 8px before the number.
  return (
    <nav
      aria-label="Categories"
      className={cn("flex w-[201px] shrink-0 flex-col border-r border-wz-rule bg-background", className)}
    >
      <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-wz-rule pl-4 pr-4">
        <h2 className="text-[18px] leading-[27px] font-semibold text-foreground">Messages</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse categories"
              aria-expanded={true}
              className={railButton}
            >
              <WzCategoriesMenuIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Collapse menu</TooltipContent>
        </Tooltip>
      </div>

      <div role="tablist" aria-orientation="vertical" className="flex flex-col px-2 py-[13px]">
        {INBOX_CATEGORIES.map((cat) => {
          const selected = active === cat.value;
          const count = countOf(cat.value);
          const text = formatCategoryCount(count);
          return (
            <Tooltip key={cat.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => pick(cat.value)}
                  className={cn(
                    "flex h-[37px] items-center justify-between rounded-[4px] border border-transparent px-2 text-[13px] leading-[19px] text-foreground",
                    "hover:border-wz-secondary-hover hover:shadow-[0_0_4px_rgba(59,75,82,0.05),0_4px_12px_rgba(59,75,82,0.1)]",
                    selected ? "bg-wz-secondary-hover font-semibold" : "font-medium",
                  )}
                >
                  <span>{cat.label}</span>
                  <span
                    className={cn("flex items-center gap-2", !countsShown && "invisible")}
                    data-testid={`category-count-${cat.value}`}
                  >
                    {count.unread ? (
                      <span data-testid="unread-dot" aria-hidden className="size-2 rounded-full bg-wz-danger" />
                    ) : null}
                    {text ? <span className={selected ? "font-semibold" : "font-normal"}>{text}</span> : null}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{categoryTooltip(cat.label, count)}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
