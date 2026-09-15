"use client";

import { useMemo } from "react";
import { Inbox, Loader2, Search, X } from "lucide-react";
import type { ConversationKind } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { normalizePhone } from "@/lib/phone";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { InboxConversation, InboxView } from "../api";
import { INBOX_VIEWS } from "../api";
import {
  useConversationByAddress,
  useConversations,
  useInboxCounters,
  usePartyNames,
} from "../hooks";
import {
  conversationTitle,
  flattenConversations,
  KIND_FILTERS,
  looksLikePhoneQuery,
  matchesSearch,
  VIEW_LABEL,
} from "../lib";
import { ConversationRow } from "./conversation-row";

export interface ListState {
  view: InboxView;
  kind?: ConversationKind;
  search: string;
}

/**
 * The left pane: tabs (All / Unread / Flagged / Archived / Mine), the
 * category chips (Clients / Team / Unknown), search, and the rows.
 *
 * Search is client-side over what is loaded — names, previews, digits —
 * plus one server lookup when the query is a phone number, so a number
 * pasted from a call log finds its thread even if it is pages down.
 */
export function ConversationList({
  state,
  onStateChange,
  selectedId,
  onSelect,
  className,
}: {
  state: ListState;
  onStateChange: (next: ListState) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
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

  const rows = useMemo(() => {
    const q = debounced.trim();
    let list: InboxConversation[] = loaded;
    if (q) list = loaded.filter((c) => matchesSearch(c, conversationTitle(c, names), q));
    if (byAddress.data && !list.some((c) => c.id === byAddress.data?.id)) {
      list = [byAddress.data, ...list];
    }
    return list;
  }, [loaded, debounced, names, byAddress.data]);

  const set = (patch: Partial<ListState>) => onStateChange({ ...state, ...patch });

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="space-y-2 border-b px-3 pt-3 pb-2">
        <div className="relative">
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

        <div role="tablist" aria-label="Inbox views" className="flex gap-0.5 overflow-x-auto">
          {INBOX_VIEWS.map((v) => {
            const count =
              v === "unread"
                ? counters?.unreadConversations
                : v === "flagged"
                  ? counters?.flaggedConversations
                  : undefined;
            const active = state.view === v;
            return (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => set({ view: v })}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {VIEW_LABEL[v]}
                {count ? (
                  <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-background" : "bg-muted")}>
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {state.view === "all" ? (
          <div className="flex gap-1" aria-label="Categories">
            {KIND_FILTERS.map((k) => {
              const active = state.kind === k.value;
              const count = counters?.unreadByKind?.[k.value];
              return (
                <button
                  key={k.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => set({ kind: active ? undefined : k.value })}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    active ? "border-brand bg-brand/10 text-brand" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {k.label}
                  {count ? <span className="tabular-nums">{count}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
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
              {debounced ? "No matching conversations" : `Nothing in ${VIEW_LABEL[state.view]}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {debounced
                ? "Try a name, a number, or a few words from the message."
                : state.view === "all"
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
