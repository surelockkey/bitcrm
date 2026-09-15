"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, Loader2, MessageSquareText, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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

export type { ListState };

/** The funnel's choices (Workiz "Filter by"): everything, or one of the secondary views. */
const FILTER_VIEWS: InboxView[] = ["all", "unread", "flagged", "mine"];

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
  className,
}: {
  state: ListState;
  onStateChange: (next: ListState) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  onNewConversation?: () => void;
  className?: string;
}) {
  const { canSend } = useMessagingAccess();
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
      <div className="flex h-14 shrink-0 items-center gap-1 border-b px-2" data-testid="list-toolbar">
        {searching ? (
          <div className="flex flex-1 items-center gap-1">
            <Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={state.search}
              onChange={(e) => set({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
              placeholder="Search by name, number or text"
              aria-label="Search conversations"
              className="h-9 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            />
            <button type="button" aria-label="Close search" onClick={closeSearch} className={toolbarButton}>
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <>
            {canSend && onNewConversation ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="New message" onClick={onNewConversation} className={toolbarButton}>
                    <MessageSquareText className="size-5" />
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
                      className={cn(toolbarButton, filterActive && "text-brand")}
                    >
                      <Filter className="size-5" />
                      {filterActive ? (
                        <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-brand" />
                      ) : null}
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Filter by</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Filter by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={filterView} onValueChange={pickFilter}>
                  {FILTER_VIEWS.map((v) => {
                    const count = filterCount(v);
                    return (
                      <DropdownMenuRadioItem key={v} value={v}>
                        <span className="flex-1">{v === "all" ? "All messages" : VIEW_LABEL[v]}</span>
                        {count ? (
                          <span className="text-xs text-muted-foreground tabular-nums">{count > 99 ? "99+" : count}</span>
                        ) : null}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Search" onClick={() => setSearching(true)} className={toolbarButton}>
                  <Search className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Search</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="conversation-list">
        {query.isLoading ? (
          <div className="space-y-3 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 pt-32 text-center">
            <NoConversationsIllustration />
            <p className="mt-6 text-[15px] font-semibold">
              {debounced ? "No conversations found" : "No conversations yet"}
            </p>
            <p className="text-[15px] text-muted-foreground">
              {debounced
                ? "Try a name, a number, or a few words from the message"
                : filterActive
                  ? `Nothing in ${INBOX_CATEGORIES.find((c) => c.value === category)?.label ?? "here"} · ${VIEW_LABEL[filterView]}`
                  : "Your messages will show up here"}
            </p>
          </div>
        ) : (
          <ul className="divide-y">
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
          <div className="p-3">
            <div ref={sentinel} aria-hidden className="h-px" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Workiz's empty list: an envelope with a "0" badge on a pale disc. */
function NoConversationsIllustration() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden className="text-foreground/70">
      <circle cx="60" cy="60" r="60" className="fill-muted" />
      <rect x="22" y="40" width="72" height="50" rx="4" className="fill-background stroke-current" strokeWidth="2" />
      <path d="M24 44 L58 70 L92 44" fill="none" className="stroke-current" strokeWidth="2" strokeLinejoin="round" />
      <path d="M24 88 L50 64 M92 88 L66 64" fill="none" className="stroke-current" strokeWidth="2" />
      <circle cx="93" cy="41" r="10" className="fill-sky-200 stroke-background" strokeWidth="3" />
      <text x="93" y="45" textAnchor="middle" fontSize="11" fontWeight="600" className="fill-sky-900">
        0
      </text>
      <path d="M40 100 H80" className="stroke-current" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
