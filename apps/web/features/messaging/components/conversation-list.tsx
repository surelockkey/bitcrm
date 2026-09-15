"use client";

import { useEffect, useMemo, useRef } from "react";
import { Inbox, Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

export type { ListState };

/** Secondary views laid over a category (Workiz starred / unread filters). */
const VIEW_TOGGLES: InboxView[] = ["unread", "flagged", "mine"];

/**
 * The middle column: search and "New" on top, the Unread / Flagged / Mine
 * toggles, then the conversations, loading more as you scroll. The
 * category itself is picked in the column to the left.
 *
 * The server indexes the category only under the plain view; with a
 * toggle on, the category narrows what is loaded client-side. Search is
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
    // A toggle view cannot be combined with a category server-side.
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
  const toggleView = (view: InboxView) => set({ view: state.view === view ? "all" : view });

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

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="space-y-2 border-b px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={state.search}
              onChange={(e) => set({ search: e.target.value })}
              placeholder="Search name, number, text…"
              aria-label="Search conversations"
              className="h-9 pl-8 pr-8"
            />
            {state.search ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => set({ search: "" })}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          {canSend && onNewConversation ? (
            <Button
              variant="brand"
              size="icon-lg"
              onClick={onNewConversation}
              aria-label="New conversation"
              title="New conversation"
            >
              <Plus className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="flex gap-1" aria-label="Views">
          {VIEW_TOGGLES.map((v) => {
            const active = state.view === v;
            const count =
              v === "unread"
                ? counters?.unreadConversations
                : v === "flagged"
                  ? counters?.flaggedConversations
                  : undefined;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={active}
                onClick={() => toggleView(v)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  active ? "border-brand bg-brand/10 text-brand" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {VIEW_LABEL[v]}
                {count ? <span className="tabular-nums">{count > 99 ? "99+" : count}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="conversation-list">
        {query.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-14 text-center">
            <Inbox className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">
              {debounced
                ? "No matching conversations"
                : `Nothing in ${INBOX_CATEGORIES.find((c) => c.value === category)?.label ?? "here"}${
                    state.view !== "all" && state.view !== "archived" ? ` · ${VIEW_LABEL[state.view]}` : ""
                  }`}
            </p>
            <p className="text-xs text-muted-foreground">
              {debounced
                ? "Try a name, a number, or a few words from the message."
                : category === "all" && state.view === "all"
                  ? "Texts from clients land here as they arrive."
                  : "Threads show up here as they get that state."}
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
              variant="outline"
              size="sm"
              className="w-full"
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
