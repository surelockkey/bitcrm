import { useCallback, useEffect, useRef } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { TeamChatCounters } from '@bitcrm/types';
import { queryKeys } from '../../lib/api/query-keys';
import type { Page } from '../../lib/api/http';
import { useQueue } from '../queue/queue-provider';
import {
  getTeamChatCounters,
  listMessages,
  listTeamThreads,
  markThreadRead,
  type FeedMessage,
  type TeamThread,
} from './api';
import { officeThreadOf } from './lib';

/**
 * How the chat stays current — and why it is a poll.
 *
 * The office reads the same data over SSE (`GET /messaging/events`), and a
 * phone cannot: `EventSource` cannot carry an `Authorization` header, RN's
 * `fetch` does not stream, and a held-open connection is the first thing the
 * OS kills when the app goes into a pocket. The service documents the fallback
 * itself — counters every 30 s, an open feed every 10 s
 * (`realtime.controller.ts:45-46`) — and that is what this does, only while
 * the screen is being looked at. The real answer for a closed app is a push
 * notification; that needs an Apple and a Google account this wave does not
 * have (docs/ARCHITECTURE.md §1.4, §2.6).
 */
export const FEED_POLL_MS = 10_000;
export const COUNTERS_POLL_MS = 30_000;

/** How many lines one page of the feed carries. */
const FEED_PAGE = 30;

/**
 * The technician's thread with the office.
 *
 * `enabled` on the id being known keeps a signed-out phone quiet; the row is
 * small and persisted, so the screen can name the thread and say what is
 * unread before the network answers.
 */
export function useOfficeThread(meId: string | undefined) {
  return useQuery<Page<TeamThread>, unknown, TeamThread | undefined>({
    queryKey: queryKeys.messaging.teamThread(),
    queryFn: () => listTeamThreads(),
    enabled: Boolean(meId),
    select: (page) => officeThreadOf(page.data, meId),
  });
}

/**
 * The feed, newest first; `fetchNextPage` loads older.
 *
 * `live` is the screen's own focus: a technician looking at a job should not
 * be paying for a poll of a thread nobody is reading. react-query stops the
 * interval on its own when the app leaves the foreground (`focusManager`, wired
 * in `lib/query/query-provider.tsx`) and when the phone is offline.
 */
export function useThreadFeed(conversationId: string | undefined, live: boolean) {
  return useInfiniteQuery<Page<FeedMessage>>({
    queryKey: queryKeys.messaging.messages(conversationId ?? ''),
    queryFn: ({ pageParam }) =>
      listMessages(conversationId as string, pageParam as string | undefined, FEED_PAGE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled: Boolean(conversationId),
    refetchInterval: live ? FEED_POLL_MS : false,
  });
}

/** The unread badge on the tab: the caller's own count, over their own threads. */
export function useTeamChatBadge() {
  return useQuery<TeamChatCounters>({
    queryKey: queryKeys.messaging.teamCounters(),
    queryFn: getTeamChatCounters,
    refetchInterval: COUNTERS_POLL_MS,
    staleTime: COUNTERS_POLL_MS,
  });
}

/**
 * Opening the thread marks it read, up to the newest line on screen.
 *
 * Quiet on failure, as the web is: a read marker that did not save is a badge
 * that stays up a little longer, not something to interrupt a technician
 * with. The last key sent is remembered so a poll that changes nothing does
 * not re-post it, and forgotten again on failure so the next poll retries.
 */
export function useMarkThreadRead(
  conversationId: string | undefined,
  newestSk: string | undefined,
  active: boolean,
): void {
  const qc = useQueryClient();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !conversationId || !newestSk) return;
    if (sent.current === newestSk) return;
    sent.current = newestSk;
    markThreadRead(conversationId, newestSk)
      .then(() => {
        void qc.invalidateQueries({ queryKey: queryKeys.messaging.teamThread() });
        void qc.invalidateQueries({ queryKey: queryKeys.messaging.teamCounters() });
      })
      .catch(() => {
        sent.current = null;
      });
  }, [active, conversationId, newestSk, qc]);
}

export interface SendToOffice {
  /** Queues the line. Resolves once it is on disk — never once it has been sent. */
  send: (text: string) => Promise<void>;
}

/**
 * Writing to the office.
 *
 * Straight into the outbox that already carries arrivals, notes and photos —
 * not a mutation. Underground, the row waits and the bubble says so; in
 * signal, the worker is woken by the insert itself and the line is gone within
 * a tick, so the two cases are one path rather than a rare branch that breaks
 * quietly (docs/ARCHITECTURE.md §2.3, §2.4).
 *
 * `conversationId` may be unknown — a phone that has never reached the server
 * has never seen the thread — and the transport resolves it at send time.
 */
export function useSendToOffice(
  conversationId: string | undefined,
  dealId?: string,
): SendToOffice {
  const { enqueueAction } = useQueue();

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body) return;
      await enqueueAction({
        kind: 'chat',
        // Empty when the line is about no job in particular: the lane the
        // worker orders by is the thread, not this (lib/queue/policy.ts).
        dealId: dealId ?? '',
        payload: { conversationId, body },
      });
    },
    [conversationId, dealId, enqueueAction],
  );

  return { send };
}
