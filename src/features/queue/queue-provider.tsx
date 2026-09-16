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
} from '../../lib/queue/db';
import { canDiscardSilently, retryPatch } from '../../lib/queue/policy';
import { drainOutbox, drainUploads } from '../../lib/queue/worker';
import type {
  OutboxKind,
  OutboxRecord,
  QueueRecord,
  UploadRecord,
} from '../../lib/queue/types';
import { performOutboxAction, presignUpload, putUpload } from './transport';

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
export function QueueProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const stores = useMemo(
    () => ({ outbox: createSqliteOutboxStore(), uploads: createSqliteUploadStore() }),
    [],
  );
  const [records, setRecords] = useState<QueueRecord[]>([]);
  const [isDraining, setIsDraining] = useState(false);
  const draining = useRef(false);

  const refresh = useCallback(async () => {
    const [outbox, uploads] = await Promise.all([
      stores.outbox.all(),
      stores.uploads.all(),
    ]);
    setRecords([
      ...outbox.map((r): QueueRecord => ({ queue: 'outbox', ...r })),
      ...uploads.map((r): QueueRecord => ({ queue: 'uploads', ...r })),
    ]);
  }, [stores]);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    setIsDraining(true);

    const touched = new Set<string>();
    let sent = 0;
    let failed = 0;
    const note = (
      record: { dealId: string },
      state: 'done' | 'failed' | 'pending',
    ) => {
      touched.add(record.dealId);
      if (state === 'done') sent += 1;
      if (state === 'failed') failed += 1;
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
        onSettled: note,
      });
    } catch {
      // A store that will not answer is not worth crashing the app over; the
      // rows are still on disk and the next wake-up tries again.
    } finally {
      draining.current = false;
      setIsDraining(false);
      await refresh();
    }

    // Whatever landed changed the job on the server. Pull the truth back,
    // replacing the optimistic stamp the screen has been showing.
    for (const dealId of touched) {
      void qc.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.deals.attachments(dealId) });
    }
    if (touched.size) {
      void qc.invalidateQueries({ queryKey: queryKeys.deals.lists() });
    }
    if (sent) hapticSuccess();
    if (failed) hapticError();
  }, [qc, refresh, stores]);

  // Wake on start, on foreground, and the moment there is a signal again.
  useEffect(() => {
    void refresh().then(() => drain());

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
      const now = Date.now();
      const record: OutboxRecord = {
        id: Crypto.randomUUID(),
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
    [drain, refresh, stores],
  );

  const enqueueUpload = useCallback<QueueContextValue['enqueueUpload']>(
    async (input) => {
      const now = Date.now();
      const record: UploadRecord = {
        id: Crypto.randomUUID(),
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
    [drain, refresh, stores],
  );

  const retry = useCallback<QueueContextValue['retry']>(
    async (queue, id) => {
      await stores[queue].update(id, retryPatch(Date.now()));
      await refresh();
      void drain();
    },
    [drain, refresh, stores],
  );

  const retryAll = useCallback(async () => {
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
      await stores[queue].remove(id);
      await refresh();
    },
    [refresh, stores],
  );

  const value = useMemo<QueueContextValue>(
    () => ({
      records,
      waiting: records.filter((r) => r.state === 'pending' || r.state === 'sending')
        .length,
      failed: records.filter((r) => r.state === 'failed').length,
      enqueueAction,
      enqueueUpload,
      retry,
      retryAll,
      discard,
      drainNow: drain,
      isDraining,
    }),
    [discard, drain, enqueueAction, enqueueUpload, isDraining, records, retry, retryAll],
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
