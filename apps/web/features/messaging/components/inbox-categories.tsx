"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Archive, Lightbulb, PanelLeft, Rows2, Users, UsersRound, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useInboxCounters } from "../hooks";
import {
  categoryOf,
  categoryState,
  categoryUnread,
  INBOX_CATEGORIES,
  type InboxCategory,
  type ListState,
} from "../lib";

/** The glyph each category gets when the column is folded to a rail (Workiz 08). */
const CATEGORY_ICON: Record<InboxCategory, LucideIcon> = {
  all: Rows2,
  requests: Lightbulb,
  clients: Users,
  team: UsersRound,
  archived: Archive,
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

const railButton =
  "relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/**
 * The left column of the Workiz Inbox: "Messages", a collapse toggle, and
 * the categories — All, Requests, Clients, Team, Archived — each with its
 * count on the right and a red dot while something in it is unread. The
 * selected one is highlighted. Folded, it is a rail of icons with the same
 * dots (reference 08).
 */
export function InboxCategories({
  state,
  onStateChange,
  collapsed,
  onToggleCollapsed,
  className,
}: {
  state: ListState;
  onStateChange: (next: ListState) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  className?: string;
}) {
  const { data: counters } = useInboxCounters();
  const active = categoryOf(state);
  const pick = (cat: InboxCategory) => onStateChange({ ...state, ...categoryState(cat, state) });

  if (collapsed) {
    return (
      <nav
        aria-label="Categories"
        data-collapsed="true"
        className={cn("flex w-14 shrink-0 flex-col items-center border-r py-2", className)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Expand categories"
              aria-expanded={false}
              className={railButton}
            >
              <PanelLeft className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Show categories</TooltipContent>
        </Tooltip>

        <div role="tablist" aria-orientation="vertical" className="mt-3 flex flex-col gap-3">
          {INBOX_CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICON[cat.value];
            const selected = active === cat.value;
            const unread = categoryUnread(cat.value, counters);
            return (
              <Tooltip key={cat.value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-label={cat.label}
                    onClick={() => pick(cat.value)}
                    className={cn(railButton, selected && "bg-muted text-foreground")}
                  >
                    <Icon className="size-5" />
                    {unread ? (
                      <span
                        data-testid="unread-dot"
                        aria-hidden
                        className="absolute right-1 top-1 size-2 rounded-full bg-destructive ring-2 ring-background"
                      />
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {cat.label}
                  {unread ? ` · ${unread} unread` : ""}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav aria-label="Categories" className={cn("flex w-48 shrink-0 flex-col border-r", className)}>
      <div className="flex h-14 shrink-0 items-center justify-between pl-4 pr-2">
        <h2 className="text-lg font-semibold tracking-tight">Messages</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Collapse categories"
              aria-expanded={true}
              className={railButton}
            >
              <PanelLeft className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Hide categories</TooltipContent>
        </Tooltip>
      </div>

      <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-px px-1.5">
        {INBOX_CATEGORIES.map((cat) => {
          const selected = active === cat.value;
          const unread = categoryUnread(cat.value, counters);
          return (
            <button
              key={cat.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => pick(cat.value)}
              className={cn(
                "flex h-9 items-center justify-between rounded-md px-2.5 text-sm transition-colors hover:bg-muted/60",
                selected ? "bg-muted font-semibold text-foreground" : "font-medium text-foreground/80",
              )}
            >
              <span>{cat.label}</span>
              <span className="flex items-center gap-1.5 tabular-nums" data-testid={`category-count-${cat.value}`}>
                {unread ? (
                  <span data-testid="unread-dot" aria-hidden className="size-1.5 rounded-full bg-destructive" />
                ) : null}
                {unread !== undefined ? (
                  <span className={selected ? "font-semibold" : "font-normal text-foreground/80"}>{unread}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
