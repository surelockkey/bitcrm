import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { InboxCounters } from '@bitcrm/types';
import { queryKeys } from '../../lib/api/query-keys';
import type { Page } from '../../lib/api/http';
import {
  getConversation,
  getInboxCounters,
  listConversations,
  listTeamThreads,
  type InboxConversation,
  type TeamThread,
} from './api';
import { useTeamChatBadge } from './hooks';
import { unreadBadge } from './lib';
import {
  chipCount,
  inCategory,
  inboxAccess,
  inboxRows,
  messagesBadgeCount,
  partyNames,
  searchRows,
  visibleCategories,
  type ChipCount,
  type InboxAccess,
  type InboxCategory,
  type InboxRow,
  type PartyNames,
} from './inbox-lib';

/**
 * How often the list refreshes itself. The service documents the poll a client
 * without SSE should fall back to — counters every 30 s, an open feed every
 * 10 s (`realtime.controller.ts:45-46`) — and a list of threads is a counter,
 * not a feed. Only while the screen is being looked at: a van's cellular plan
 * pays for every one of these.
 */
export const INBOX_POLL_MS = 30_000;

/** One page of the list. A technician has tens of threads, so this is usually all of them. */
const INBOX_PAGE = 50;

/**
 * The conversation list.
 *
 * `useInfiniteQuery` rather than a plain one because the endpoint is
 * cursor-paged and a dispatcher signing in on a phone has an inbox that does
 * not fit in a page. For a technician the first page is the whole thing.
 */
export function useConversations(live: boolean) {
  return useInfiniteQuery<Page<InboxConversation>>({
    queryKey: queryKeys.messaging.conversations(),
    queryFn: ({ pageParam }) => listConversations(pageParam as string | undefined, INBOX_PAGE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    refetchInterval: live ? INBOX_POLL_MS : false,
  });
}

/** The category totals and the office's unread flags, scoped to this caller. */
export function useInboxCounters(live: boolean) {
  return useQuery<InboxCounters>({
    queryKey: queryKeys.messaging.inboxCounters(),
    queryFn: getInboxCounters,
    refetchInterval: live ? INBOX_POLL_MS : false,
    staleTime: INBOX_POLL_MS,
  });
}

/**
 * The staff threads, for the one thing the inbox route does not carry: this
 * caller's own read state (`viewerUnread` — `team-counters.service.ts:13-21`).
 * It is also the fallback list, so an account that may read its office thread
 * but not the inbox still has a Messages screen with something in it.
 */
export function useTeamThreads() {
  return useQuery<Page<TeamThread>, unknown, TeamThread[]>({
    queryKey: queryKeys.messaging.teamThread(),
    queryFn: () => listTeamThreads(),
    select: (page) => page.data,
  });
}

export interface UseInboxResult {
  /** Every row this phone has, newest activity first, whatever chip is on. */
  rows: InboxRow[];
  /** The rows under the chosen chip, narrowed by the search box. */
  visible: InboxRow[];
  /** Which chips to draw — Requests only when this viewer can actually have one. */
  categories: InboxCategory[];
  counts: Record<InboxCategory, ChipCount>;
  /** What this account is allowed to see, and what to say about the rest. */
  access: InboxAccess;
  /** True only while there is nothing at all to draw. */
  loading: boolean;
  isRefetching: boolean;
  /** The error worth showing — never one that a cached list already answers. */
  error: unknown;
  /** A refresh that failed over a list this phone already has: a strip, not a screen. */
  staleError: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
}

/**
 * The Messages screen's data, assembled from the two endpoints that each know
 * half of it.
 *
 * `GET /conversations` knows which threads exist and how big each category is;
 * `GET /team/conversations` knows what **this** technician has read of their
 * own thread. Merged here rather than in the screen so the merge is a test,
 * and so the chips, the rows and the tab badge are all reading one assembly.
 *
 * `deals` is the technician's own jobs, already on this phone — the only
 * source of client names that works with no signal. See `partyNames`.
 */
export function useInbox(
  category: InboxCategory,
  search: string,
  deals: readonly { contactId?: string; clientName?: { firstName?: string; lastName?: string } }[],
  live: boolean,
): UseInboxResult {
  const conversations = useConversations(live);
  const counters = useInboxCounters(live);
  const team = useTeamThreads();
  const teamCounters = useTeamChatBadge();

  const names: PartyNames = useMemo(() => partyNames(deals), [deals]);

  const loaded = useMemo(
    () => conversations.data?.pages.flatMap((page) => page.data) ?? [],
    [conversations.data?.pages],
  );
  const teamRows = useMemo(() => team.data ?? [], [team.data]);

  const rows = useMemo(
    () => inboxRows(loaded, teamRows, names),
    [loaded, teamRows, names],
  );

  const visible = useMemo(
    () => searchRows(rows.filter((row) => inCategory(row.kind, category)), search),
    [rows, category, search],
  );

  const access = useMemo(
    () => inboxAccess(conversations.error, team.error, teamRows.length > 0),
    [conversations.error, team.error, teamRows.length],
  );

  const complete = !conversations.hasNextPage;
  const counts = useMemo(() => {
    const byCategory = {} as Record<InboxCategory, ChipCount>;
    for (const cat of ['all', 'requests', 'clients', 'team'] as const) {
      const count = rows.filter((row) => inCategory(row.kind, cat)).length;
      byCategory[cat] = chipCount(cat, counters.data, teamCounters.data, {
        count,
        complete,
      });
    }
    return byCategory;
  }, [rows, counters.data, teamCounters.data, complete]);

  const loadedKinds = useMemo(() => rows.map((row) => row.kind), [rows]);

  return {
    rows,
    visible,
    categories: visibleCategories(counters.data, loadedKinds),
    counts,
    access,
    // `isLoading`, not `isPending`: a query that is switched off is pending
    // for ever, and a spinner that never resolves is the one thing a screen
    // opened in a tunnel must not do.
    loading: (conversations.isLoading || team.isLoading) && !rows.length,
    isRefetching: conversations.isRefetching || team.isRefetching,
    // A cached list answers the question the error would have; the screen
    // shows a quiet "could not reach the server" strip over it instead. A
    // refusal is not one of those: `access` has already turned it into a
    // sentence about this account's role, and repeating it as a network
    // failure would be two different explanations of one thing.
    error: rows.length ? null : (conversations.error ?? team.error),
    staleError:
      rows.length && !access.clientsRefused
        ? (conversations.error ?? team.error)
        : null,
    hasNextPage: Boolean(conversations.hasNextPage),
    isFetchingNextPage: conversations.isFetchingNextPage,
    fetchNextPage: () => {
      if (conversations.hasNextPage && !conversations.isFetchingNextPage) {
        void conversations.fetchNextPage();
      }
    },
    refetch: () => {
      void conversations.refetch();
      void counters.refetch();
      void team.refetch();
      void teamCounters.refetch();
    },
  };
}

export interface UseConversationResult {
  conversation: InboxConversation | undefined;
  loading: boolean;
  error: unknown;
}

/**
 * The one conversation a thread screen was opened on.
 *
 * The cached list is asked first and answers instantly — the technician has
 * just tapped that exact row, and in a tunnel it is the only copy there is.
 * The request behind it is only for the case the list has never loaded: a
 * notification opened on a cold phone. Asking the network first would put a
 * spinner in front of a row that is already on the screen behind it.
 */
export function useConversation(id: string | undefined): UseConversationResult {
  const conversations = useConversations(false);
  const team = useTeamThreads();

  const cached = useMemo(() => {
    if (!id) return undefined;
    const fromInbox = conversations.data?.pages
      .flatMap((page) => page.data)
      .find((c) => c.id === id);
    return fromInbox ?? team.data?.find((t) => t.id === id);
  }, [id, conversations.data?.pages, team.data]);

  // Only once the lists this phone keeps have had their say. Firing both at
  // once would race them, and the request that loses is one a technician on a
  // cellular plan paid for to learn what the row they just tapped already
  // said.
  const listsSettled = !conversations.isLoading && !team.isLoading;

  const fetched = useQuery<InboxConversation>({
    queryKey: queryKeys.messaging.conversation(id ?? ''),
    queryFn: () => getConversation(id as string),
    enabled: Boolean(id) && !cached && listsSettled,
  });

  return {
    conversation: cached ?? fetched.data,
    loading: !cached && (!listsSettled || fetched.isLoading),
    error: cached ? null : fetched.error,
  };
}

/**
 * The badge on the Messages tab.
 *
 * Reads the same two counters the chips read and runs them through the same
 * function, so the number on the tab is the `All` chip's unread by
 * construction — not a second count that drifts from it. Kept here rather than
 * in the tab layout so the tab has one import and no arithmetic.
 *
 * Returns `undefined` at zero: react-navigation draws a badge for any defined
 * value, and an empty circle over "Messages" reads as an unread message that
 * is not there.
 */
export function useMessagesBadge(): string | undefined {
  const inbox = useInboxCounters(true);
  const team = useTeamChatBadge();
  return unreadBadge(messagesBadgeCount(inbox.data, team.data));
}
