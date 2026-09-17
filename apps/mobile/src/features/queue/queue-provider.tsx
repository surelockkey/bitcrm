import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/api/query-keys';
import { hapticError, hapticSuccess } from '../../lib/haptics';
import {
  createSqliteOutboxStore,
  createSqliteUploadStore,
  recoverQueuesForUser,
} from '../../lib/queue/db';
import { canDiscardSilently, isThreadKind, retryPatch } from '../../lib/queue/policy';
import { drainOutbox, drainUploads } from '../../lib/queue/worker';
import type {
  OutboxKind,
  OutboxRecord,
  QueueRecord,
  UploadRecord,
} from '../../lib/queue/types';
import { useAuth } from '../auth/auth-context';
import { applyPatchToList } from '../jobs/optimistic';
import type { Deal } from '../jobs/types';
import type { FeedMessage } from '../messaging/api';
import { feedWithLandedLine, type FeedPages } from '../messaging/lib';
import {
  deleteLocalPhoto,
  discardAttachment,
  performOutboxAction,
  presignUpload,
  putUpload,
  sweepOrphanedPhotos,
} from './transport';

export interface EnqueueUpload {
  dealId: string;
  localUri: string;
  fileName: string;
  contentType: string;
  size?: number;
  category?: string;
}

export interface QueueContextValue {
  records: QueueRecord[];
  /** Rows still on their way — what the badge counts. */
  waiting: number;
  /** Rows the queue has given up on. These need a person. */
  failed: number;
  enqueueAction: (input: {
    kind: OutboxKind;
    dealId: string;
    payload: unknown;
  }) => Promise<string>;
  /**
   * Add to a queued action's payload, provided it has not left yet.
   *
   * There is exactly one caller: "Arrived" is queued the instant it is tapped,
   * with no coordinates, and the GPS fix — which can take up to eight seconds —
   * is folded in afterwards. A row already sent, in flight or parked is left
   * alone; an arrival without a fix is a valid arrival (§2.9).
   */
  patchActionPayload: (id: string, extra: object) => Promise<void>;
  enqueueUpload: (input: EnqueueUpload) => Promise<string>;
  retry: (queue: 'outbox' | 'uploads', id: string) => Promise<void>;
  retryAll: () => Promise<void>;
  discard: (queue: 'outbox' | 'uploads', id: string) => Promise<void>;
  drainNow: () => Promise<void>;
  isDraining: boolean;
}

const QueueContext = createContext<QueueContextValue | null>(null);

/** How often to look again while something is still waiting out a backoff. */
const TICK_MS = 30_000;

/**
 * Owns the two offline queues and the worker that empties them.
 *
 * The worker is woken by everything that could plausibly change the answer —
 * app start, returning to the foreground, connectivity coming back, and each
 * new item — plus a slow tick while anything is waiting out a backoff. It is
 * never *relied* on to run in the background: Android has no equivalent of
 * iOS's background upload session, so "drained whenever the app is open" is
 * the promise we can actually keep on both platforms (docs/STACK.md §2.1).
 */
/** Does this look like the `Deal` an action answered with? */
function asDeal(result: unknown): Deal | undefined {
  return result && typeof result === 'object' && 'id' in result
    ? (result as Deal)
    : undefined;
}

/** Does this look like the stored line `POST …/messages` answered with? */
function asFeedMessage(result: unknown): FeedMessage | undefined {
  return result &&
    typeof result === 'object' &&
    typeof (result as FeedMessage).id === 'string' &&
    typeof (result as FeedMessage).conversationId === 'string'
    ? (result as FeedMessage)
    : undefined;
}

/**
 * How many times a wake-up may drain in a row.
 *
 * One pass takes at most one row per ordering lane, because a lane's rows must
 * not overtake one another (lib/queue/policy.ts). Without a second pass the
 * rest of a lane waits for the next tick — thirty seconds in which a second
 * line typed straight after the first says "Waiting for a signal" on a phone
 * with five bars. So the drain keeps going while it is making progress, and
 * the bound is here only so a pathological store cannot spin.
 */
const MAX_DRAIN_PASSES = 20;

export function QueueProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { state } = useAuth();
  const userId = state.status === 'signedIn' ? state.user.id : null;

  /**
   * Both queues, bound to the technician who is signed in — and absent when
   * nobody is.
   *
   * Everything below reads `stores` before it does anything, which is what
   * makes the session gate total rather than a check in one place. It closes
   * two holes at once: a drain with no Authorization header, which the gateway
   * answers 401 (queue rows used to be parked for good on the strength of it),
   * and a van's phone handed to the next technician with the last one's
   * arrivals and notes still in the queue, ready to be re-sent under the wrong
   * name (docs/ARCHITECTURE.md §2.3).
   *
   * The cold-start race is closed by the same gate: `QueueProvider` is a child
   * of `AuthProvider`, so its effects run first, and until `loadTokens()` has
   * answered the auth state is `loading` — not `signedIn` — so nothing drains.
   */
  const stores = useMemo(
    () =>
      userId
        ? {
            outbox: createSqliteOutboxStore(userId),
            uploads: createSqliteUploadStore(userId),
          }
        : null,
    [userId],
  );

  const [records, setRecords] = useState<QueueRecord[]>([]);
  const [isDraining, setIsDraining] = useState(false);
  const draining = useRef(false);
  /**
   * A wake-up that arrived while a drain was already running.
   *
   * Everything that wakes the worker — a new row, connectivity returning,
   * the app coming back — used to be dropped outright if a drain happened to
   * be in flight, and the work then waited for the slow tick.
   */
  const wakeAgain = useRef(false);

  const refresh = useCallback(async () => {
    if (!stores) {
      setRecords([]);
      return;
    }
    const [outbox, uploads] = await Promise.all([
      stores.outbox.all(),
      stores.uploads.all(),
    ]);
    setRecords([
      ...outbox.map((r): QueueRecord => ({ queue: 'outbox', ...r })),
      ...uploads.map((r): QueueRecord => ({ queue: 'uploads', ...r })),
    ]);
  }, [stores]);

  /** One sweep of both queues. Answers with how many rows actually landed. */
  const drainPass = useCallback(async (): Promise<number> => {
    if (!stores) return 0;

    /** Jobs whose server-side copy we now hold, straight from the response. */
    const fresh = new Map<string, Deal>();
    /** Jobs that changed but did not hand one back. */
    const stale = new Set<string>();
    /** Lines that reached the office, as the office itself stored them. */
    const landed: FeedMessage[] = [];
    /** A line reached the office — the thread has to show the real message. */
    let chatLanded = false;
    let sent = 0;
    let failed = 0;
    const note = (
      record: { dealId: string; kind?: OutboxKind },
      settledAs: 'done' | 'failed' | 'pending',
      result?: unknown,
    ) => {
      if (settledAs === 'done') {
        sent += 1;
        // A line in a thread — to the office or to the client — changed no
        // field of the job: what changed is the thread it landed in.
        if (isThreadKind(record.kind)) {
          chatLanded = true;
          const message = asFeedMessage(result);
          if (message) landed.push(message);
          return;
        }
        const deal = asDeal(result);
        if (deal) fresh.set(record.dealId, deal);
        else stale.add(record.dealId);
        return;
      }
      if (settledAs === 'failed') {
        failed += 1;
        // The failed line stays visible in the thread from its queue row, so
        // there is nothing to re-read; a job, on the other hand, may have
        // moved under the optimistic patch that is still on screen.
        if (record.dealId) stale.add(record.dealId);
      }
    };

    try {
      await drainOutbox({
        store: stores.outbox,
        send: performOutboxAction,
        onSettled: note,
      });
      await drainUploads({
        store: stores.uploads,
        presign: presignUpload,
        put: putUpload,
        discardAttachment,
        deleteLocalFile: deleteLocalPhoto,
        onSettled: note,
      });
    } catch {
      // A store that will not answer is not worth crashing the app over; the
      // rows are still on disk and the next wake-up tries again.
    } finally {
      await refresh();
    }

    // What landed changed the job on the server, and the optimistic stamp the
    // screen has been showing has to give way to the server's own copy.
    //
    // Where the action answered with the job — confirm, arrived, status — that
    // copy *is* the truth, so it is written into the cache directly. The list
    // is patched rather than invalidated: `GET /deals` has no date filter, so
    // invalidating it re-downloads the technician's entire job history, up to
    // fifty sequential pages over cellular, for one tap on "Arrived" (§1.2).
    for (const [dealId, deal] of fresh) {
      qc.setQueryData<Deal>(queryKeys.deals.detail(dealId), deal);
      qc.setQueriesData<Deal[]>({ queryKey: queryKeys.deals.lists() }, (list) =>
        applyPatchToList(list, dealId, deal),
      );
      void qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
    }
    // A note, a text or a photo: nothing that changes a row of the day list,
    // so one job and its sub-resources, never the list.
    for (const dealId of stale) {
      if (fresh.has(dealId)) continue;
      void qc.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.deals.attachments(dealId) });
    }
    // The office's own copy of the line goes straight in, in the same render
    // that drops the pending row — the invalidation below is a round trip, and
    // a message that is on neither list until it answers is a message the
    // technician will type again.
    for (const message of landed) {
      // A poll that went out before this line was stored would otherwise
      // answer after it and overwrite the thread without it. Cancelling
      // reverts to what the cache already held; the invalidation below then
      // asks again, with the line in it.
      await qc.cancelQueries({
        queryKey: queryKeys.messaging.messages(message.conversationId),
      });
      qc.setQueryData<FeedPages>(
        queryKeys.messaging.messages(message.conversationId),
        (previous) => feedWithLandedLine(previous, message),
      );
    }
    // The thread's own row — its preview, its stamp, the read state — and the
    // badge. The feed is invalidated with them so anything the office wrote
    // while this phone was underground arrives too.
    if (chatLanded) void qc.invalidateQueries({ queryKey: queryKeys.messaging.all() });
    if (sent) hapticSuccess();
    if (failed) hapticError();
    return sent;
  }, [qc, refresh, stores]);

  /**
   * A wake-up: drains, and keeps draining while it is getting somewhere.
   *
   * One pass takes at most one row per lane, so a technician who types two
   * lines — or taps "Arrived" and then "Done" — needs more than one. Anything
   * requested while this was running is honoured rather than dropped.
   */
  const drain = useCallback(async () => {
    if (!stores) return;
    if (draining.current) {
      wakeAgain.current = true;
      return;
    }
    draining.current = true;
    setIsDraining(true);
    try {
      for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
        wakeAgain.current = false;
        const sent = await drainPass();
        // Nothing landed and nobody asked again: whatever is left is waiting
        // out a backoff, and hammering it is not what a backoff is for.
        if (!sent && !wakeAgain.current) break;
      }
    } finally {
      draining.current = false;
      setIsDraining(false);
    }
  }, [drainPass, stores]);

  // Wake on start, on foreground, and the moment there is a signal again —
  // and only ever with a session behind it. Rows this technician left `sending`
  // when they last signed out are recovered first: signing out abandons a
  // request as completely as a crash does, and nothing else moves them.
  useEffect(() => {
    const start = userId
      ? recoverQueuesForUser(userId).catch(() => {})
      : Promise.resolve();
    void start.then(refresh).then(() => drain());

    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') void drain();
    });
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online) void drain();
    });

    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [drain, refresh]);

  // Captures no row points at any more: a discarded photo, a crash between the
  // copy and the insert. Left alone, they accumulate until a reinstall (§2.4).
  useEffect(() => {
    void sweepOrphanedPhotos();
  }, []);

  // A backoff has to be woken by something; while the queue is empty, nothing
  // ticks at all.
  const hasWork = records.some((r) => r.state === 'pending' || r.state === 'sending');
  useEffect(() => {
    if (!hasWork) return;
    const timer = setInterval(() => void drain(), TICK_MS);
    return () => clearInterval(timer);
  }, [drain, hasWork]);

  const enqueueAction = useCallback<QueueContextValue['enqueueAction']>(
    async ({ kind, dealId, payload }) => {
      if (!stores || !userId) {
        throw new Error('Cannot queue an action without a signed-in technician');
      }
      const now = Date.now();
      const record: OutboxRecord = {
        id: Crypto.randomUUID(),
        userId,
        kind,
        dealId,
        payload: JSON.stringify(payload ?? {}),
        createdAt: now,
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        state: 'pending',
      };
      await stores.outbox.insert(record);
      await refresh();
      void drain();
      return record.id;
    },
    [drain, refresh, stores, userId],
  );

  const patchActionPayload = useCallback<QueueContextValue['patchActionPayload']>(
    async (id, extra) => {
      if (!stores) return;
      const row = (await stores.outbox.all()).find((r) => r.id === id);
      // Only a row that has not been picked up yet. Rewriting one in flight
      // would change what the request said after it had already been said.
      if (!row || row.state !== 'pending') return;
      const payload = { ...(JSON.parse(row.payload) as object), ...extra };
      await stores.outbox.update(id, { payload: JSON.stringify(payload) });
      await refresh();
    },
    [refresh, stores],
  );

  const enqueueUpload = useCallback<QueueContextValue['enqueueUpload']>(
    async (input) => {
      if (!stores || !userId) {
        throw new Error('Cannot queue a photo without a signed-in technician');
      }
      const now = Date.now();
      const record: UploadRecord = {
        id: Crypto.randomUUID(),
        userId,
        dealId: input.dealId,
        localUri: input.localUri,
        fileName: input.fileName,
        contentType: input.contentType,
        size: input.size ?? null,
        category: input.category ?? null,
        attachmentId: null,
        uploadUrl: null,
        uploadHeaders: null,
        progress: 0,
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        state: 'pending',
        createdAt: now,
      };
      await stores.uploads.insert(record);
      await refresh();
      void drain();
      return record.id;
    },
    [drain, refresh, stores, userId],
  );

  const retry = useCallback<QueueContextValue['retry']>(
    async (queue, id) => {
      if (!stores) return;
      await stores[queue].update(id, retryPatch(Date.now()));
      await refresh();
      void drain();
    },
    [drain, refresh, stores],
  );

  const retryAll = useCallback(async () => {
    if (!stores) return;
    const patch = retryPatch(Date.now());
    await Promise.all(
      records
        .filter((r) => r.state === 'failed')
        .map((r) => stores[r.queue].update(r.id, patch)),
    );
    await refresh();
    void drain();
  }, [drain, records, refresh, stores]);

  const discard = useCallback<QueueContextValue['discard']>(
    async (queue, id) => {
      if (!stores) return;
      if (queue === 'uploads') {
        const row = records.find((r) => r.queue === 'uploads' && r.id === id);
        if (row?.queue === 'uploads') await deleteLocalPhoto(row);
      }
      await stores[queue].remove(id);
      await refresh();
    },
    [records, refresh, stores],
  );

  const value = useMemo<QueueContextValue>(
    () => ({
      records,
      waiting: records.filter((r) => r.state === 'pending' || r.state === 'sending')
        .length,
      failed: records.filter((r) => r.state === 'failed' || r.state === 'unknown')
        .length,
      enqueueAction,
      patchActionPayload,
      enqueueUpload,
      retry,
      retryAll,
      discard,
      drainNow: drain,
      isDraining,
    }),
    [
      discard,
      drain,
      enqueueAction,
      enqueueUpload,
      isDraining,
      patchActionPayload,
      records,
      retry,
      retryAll,
    ],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error('useQueue must be used within a QueueProvider');
  return ctx;
}

/** Re-exported so screens can ask before offering "Discard". */
export { canDiscardSilently };
