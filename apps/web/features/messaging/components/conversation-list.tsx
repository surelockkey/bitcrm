"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { normalizePhone } from "@/lib/phone";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { InboxConversation, InboxView } from "../api";
import {
  useConversationByAddress,
  useConversations,
  useInboxCounters,
  useMessagingAccess,
  usePartyNames,
} from "../hooks";
import {
  categoryOf,
  conversationInCategory,
  conversationTitle,
  flattenConversations,
  INBOX_CATEGORIES,
  looksLikePhoneQuery,
  matchesSearch,
  VIEW_LABEL,
  type ListState,
} from "../lib";
import { ConversationRow } from "./conversation-row";
import { GroupMenu, toolbarButton } from "./group-menu";
import { WzBounceDots } from "./bounce-dots";
import { NoConversationsArt } from "./inbox-art";
import { WzFilterIcon, WzNewMessageIcon, WzSearchIcon } from "./inbox-icons";

export type { ListState };

/**
 * The funnel's choices (Workiz "Filter by": All / Read / Unread / Starred).
 * "Mine" is ours (assignment); Workiz's "Read" has no server view here.
 */
const FILTER_VIEWS: InboxView[] = ["all", "unread", "flagged", "mine"];

/** pg_messages_wz_05_filter_open: 125px, r8, react-select's ring-and-drop shadow. */
const filterMenu =
  "min-w-[125px] w-auto rounded-[8px] px-0 py-1 shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)]";
const filterItem =
  "h-9 gap-3 py-0 pl-5 pr-10 text-[14px] leading-4 text-foreground focus:bg-[#deebff] data-[state=checked]:bg-[rgba(80,213,140,0.2)] data-[state=checked]:font-semibold [&_[data-slot=dropdown-menu-radio-item-indicator]]:right-4 [&_[data-slot=dropdown-menu-radio-item-indicator]]:text-wz-switch-on";

/**
 * The middle column of the Workiz Inbox. A toolbar — new message, team
 * groups, the filter funnel, and a search icon that unfolds into a field —
 * over the conversations, loading more as you scroll. The category itself
 * is picked in the column to the left.
 *
 * The server indexes the category only under the plain view; with a
 * filter on, the category narrows what is loaded client-side. Search is
 * client-side over the loaded rows — names, previews, digits — plus one
 * server lookup when the query is a phone number, so a number pasted
 * from a call log finds its thread even if it is pages down.
 */
export function ConversationList({
  state,
  onStateChange,
  selectedId,
  onSelect,
  onNewConversation,
  rowsShown,
  className,
}: {
  state: ListState;
  onStateChange: (next: ListState) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  onNewConversation?: () => void;
  /**
   * Whether the rows may be drawn — the inbox holds them until the category
   * numbers are in as well. On its own the list draws them once they load.
   */
  rowsShown?: boolean;
  className?: string;
}) {
  const { canSend, isLoading: accessLoading } = useMessagingAccess();
  const [searching, setSearching] = useState(state.search.length > 0);
  const filter = useMemo(
    () => ({ view: state.view, kind: state.view === "all" ? state.kind : undefined }),
    [state.view, state.kind],
  );
  const query = useConversations(filter);
  const { data: counters } = useInboxCounters();
  const loaded = useMemo(() => flattenConversations(query.data?.pages), [query.data]);
  const names = usePartyNames(loaded);

  const debounced = useDebouncedValue(state.search, 300);
  const phoneQuery = looksLikePhoneQuery(debounced) ? normalizePhone(debounced) : null;
  const byAddress = useConversationByAddress(phoneQuery ?? undefined);

  const category = categoryOf(state);
  const rows = useMemo(() => {
    const q = debounced.trim();
    let list: InboxConversation[] = loaded;
    // A filter view cannot be combined with a category server-side.
    if (state.view !== "all" && state.view !== "archived" && state.kind) {
      list = list.filter((c) => conversationInCategory(c, category));
    }
    if (q) list = list.filter((c) => matchesSearch(c, conversationTitle(c, names), q));
    if (byAddress.data && !list.some((c) => c.id === byAddress.data?.id)) {
      list = [byAddress.data, ...list];
    }
    return list;
  }, [loaded, debounced, names, byAddress.data, state.view, state.kind, category]);

  const set = (patch: Partial<ListState>) => onStateChange({ ...state, ...patch });
  const filterView: InboxView = state.view === "archived" ? "all" : state.view;
  const filterActive = filterView !== "all";
  const pickFilter = (v: string) => set({ view: v as InboxView });
  const closeSearch = () => {
    setSearching(false);
    set({ search: "" });
  };

  // Infinite scroll: a sentinel at the end of the list asks for the next
  // page; the button below it is the fallback (and what tests drive).
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filterCount = (v: InboxView): number | undefined =>
    v === "unread" ? counters?.unreadConversations : v === "flagged" ? counters?.flaggedConversations : undefined;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* Workiz's list bar (`ms_topbar`, pg_messages_wz_01_list): 58px, white,
          16px in, ruled #ccc underneath; New message + group at the left,
          Filter by + Search at the right, 9px apart. Out of sight until the
          permissions say whether "New message" is one of its buttons: drawn
          without it, the group button stood in its place and slid over when
          it arrived. */}
      <div
        className={cn(
          "flex h-[58px] shrink-0 items-center border-b border-input bg-background px-4",
          accessLoading && "invisible",
        )}
        data-testid="list-toolbar"
      >
        {canSend && onNewConversation ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="New message" onClick={onNewConversation} className={toolbarButton}>
                <WzNewMessageIcon />
              </button>
            </TooltipTrigger>
            <TooltipContent>New message</TooltipContent>
          </Tooltip>
        ) : null}
        <GroupMenu onSelect={onSelect} />

        <span className="flex-1" />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={filterActive ? `Filter: ${VIEW_LABEL[filterView]}` : "Filter"}
                  className={cn(toolbarButton, filterActive && "bg-wz-secondary-hover")}
                >
                  <WzFilterIcon />
                  {filterActive ? (
                    <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-wz-switch-on" />
                  ) : null}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Filter by</TooltipContent>
          </Tooltip>
          {/* Workiz's Filter by: a react-select menu, 125px, r8, 36px rows,
              the chosen one semibold on a pale green with a green tick. */}
          <DropdownMenuContent align="end" sideOffset={-14} alignOffset={0} className={filterMenu}>
            <DropdownMenuRadioGroup value={filterView} onValueChange={pickFilter}>
              {FILTER_VIEWS.map((v) => {
                const count = filterCount(v);
                return (
                  <DropdownMenuRadioItem key={v} value={v} className={filterItem}>
                    <span className="flex-1">{VIEW_LABEL[v]}</span>
                    {count ? (
                      <span className="text-[12px] text-wz-caption">{count > 99 ? "99+" : count}</span>
                    ) : null}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Search"
              aria-expanded={searching}
              onClick={() => (searching ? closeSearch() : setSearching(true))}
              className={cn(toolbarButton, "ml-[9px]", searching && "bg-wz-secondary-hover")}
            >
              <WzSearchIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent>Search</TooltipContent>
        </Tooltip>
      </div>

      {/* Workiz's search (`ms_search`, pg_messages_wz_06*): a strip under the
          bar, 8px 12px round a 46px box edged #50d58c, r8, 14px #666, with a
          round × once something is typed. */}
      {searching ? (
        <div className="relative flex shrink-0 bg-background px-3 py-2">
          <input
            autoFocus
            value={state.search}
            onChange={(e) => set({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
            }}
            placeholder="Search..."
            aria-label="Search conversations"
            className="h-[46px] w-full rounded-[8px] border border-wz-switch-on bg-background px-3 py-[14px] text-[14px] leading-4 text-wz-text outline-none placeholder:text-wz-placeholder"
          />
          {state.search ? (
            <button
              type="button"
              aria-label="Close search"
              onClick={closeSearch}
              className="absolute right-[22px] top-[22px] grid size-[18px] place-items-center rounded-full bg-wz-caption text-white"
            >
              <X className="size-3" strokeWidth={2.5} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto bg-background" data-testid="conversation-list">
        {!(rowsShown ?? !query.isLoading) ? (
          <div aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex h-[74px] items-center pb-[14px] pl-4 pr-3 pt-3">
                <Skeleton className="mr-2.5 size-[35px] rounded-full" />
                <span className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3 w-4/5" />
                </span>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 pt-32 text-center">
            <NoConversationsArt />
            <p className="mt-6 text-[14px] leading-[21px] font-semibold text-foreground">
              {debounced ? "No conversations found" : "No conversations yet"}
            </p>
            <p className="text-[14px] leading-[21px] text-wz-outline-label">
              {debounced
                ? "Try a name, a number, or a few words from the message"
                : filterActive
                  ? `Nothing in ${INBOX_CATEGORIES.find((c) => c.value === category)?.label ?? "here"} · ${VIEW_LABEL[filterView]}`
                  : "Your messages will show up here"}
            </p>
          </div>
        ) : (
          <ul>
            {rows.map((c) => (
              <li key={c.id}>
                <ConversationRow
                  conversation={c}
                  title={conversationTitle(c, names)}
                  active={c.id === selectedId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage && !debounced ? (
          <div className="flex h-12 items-center justify-center">
            <div ref={sentinel} aria-hidden className="h-px" />
            {query.isFetchingNextPage ? (
              <WzBounceDots />
            ) : (
              <button
                type="button"
                onClick={() => query.fetchNextPage()}
                className="text-[13px] leading-[19px] font-semibold text-wz-link hover:underline"
              >
                Load more
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
