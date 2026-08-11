"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";
import { queryKeys } from "@/lib/query-keys";
import { CALLS_STREAM_PATH } from "./api";
import { createSseParser } from "./sse";
import { isLive, type CallRecord } from "./lib";

interface CallEvent {
  type: "call.upserted" | "call.recording_ready";
  call: CallRecord;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const LIST_INVALIDATE_DEBOUNCE_MS = 2_000;

/**
 * Live call updates over SSE. Opened with fetch (EventSource can't send the
 * Bearer header), parsed incrementally, and applied straight into the query
 * cache: the live list is patched in place, the detail entry is updated, and
 * the paginated history list is invalidated (debounced). Reconnects with
 * exponential backoff; the 30s fallback poll in useLiveCalls covers gaps.
 */
export function useCallStream(enabled = true) {
  const qc = useQueryClient();
  const qcRef = useRef(qc);
  qcRef.current = qc;

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let backoff = RECONNECT_MIN_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const applyEvent = (event: CallEvent) => {
      const call = event.call;
      // The hidden receiving side of an internal call never reaches the UI
      // (the backend suppresses these too — this is a belt-and-braces guard).
      if (call.internalLegOf) return;
      const client = qcRef.current;

      // Live section: insert/update, or drop the row once the call ends.
      client.setQueryData<CallRecord[]>(queryKeys.calls.live(), (prev) => {
        const rest = (prev ?? []).filter((c) => c.callSid !== call.callSid);
        return isLive(call) ? [call, ...rest] : rest;
      });

      // Detail page (if open).
      client.setQueryData<CallRecord>(
        queryKeys.calls.detail(call.callSid),
        (prev) => ({ ...prev, ...call }),
      );

      // History list — debounced invalidate (bursts of webhooks arrive together).
      if (!invalidateTimer) {
        invalidateTimer = setTimeout(() => {
          invalidateTimer = null;
          void client.invalidateQueries({ queryKey: queryKeys.calls.lists() });
        }, LIST_INVALIDATE_DEBOUNCE_MS);
      }
    };

    const connect = async () => {
      try {
        const res = await fetch(`${env.apiBaseUrl}${CALLS_STREAM_PATH}`, {
          headers: { Authorization: `Bearer ${getIdToken() ?? ""}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        backoff = RECONNECT_MIN_MS; // connected — reset the backoff
        const parser = createSseParser((data) => {
          try {
            applyEvent(JSON.parse(data) as CallEvent);
          } catch {
            /* malformed frame — skip */
          }
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
        throw new Error("stream closed");
      } catch {
        if (stopped) return;
        reconnectTimer = setTimeout(() => {
          backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
          void connect();
        }, backoff);
      }
    };

    void connect();

    return () => {
      stopped = true;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (invalidateTimer) clearTimeout(invalidateTimer);
    };
  }, [enabled]);
}
