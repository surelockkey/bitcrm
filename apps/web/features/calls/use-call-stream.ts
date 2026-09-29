"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";
import { queryKeys } from "@/lib/query-keys";
import { CALLS_STREAM_PATH } from "./api";
import { openSharedSseStream } from "@/lib/shared-sse-stream";
import { isLive, type CallRecord } from "./lib";

interface CallEvent {
  type: "call.upserted" | "call.recording_ready";
  call: CallRecord;
}

const LIST_INVALIDATE_DEBOUNCE_MS = 2_000;

function parseCallFrame(data: string): CallEvent | null {
  try {
    const event = JSON.parse(data) as CallEvent | null;
    return event && typeof event === "object" && event.call ? event : null;
  } catch {
    return null;
  }
}

/**
 * Live call updates over SSE — the one stream every tab of this browser
 * shares (`openSharedSseStream`), applied straight into the query cache: the
 * live list is patched in place, the detail entry is updated, and the
 * paginated history list is invalidated (debounced). The shared opener
 * reconnects with backoff; the 30s fallback poll in useLiveCalls covers gaps.
 */
export function useCallStream(enabled = true) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;

    const applyEvent = (event: CallEvent) => {
      const call = event.call;
      // The hidden receiving side of an internal call never reaches the UI
      // (the backend suppresses these too — this is a belt-and-braces guard).
      if (call.internalLegOf) return;
      const client = qc;

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

      // "The call I'm on" — every tab watches this, including the ones with no
      // Device of their own, so a follower's strip updates the moment the
      // owner's call does rather than on the next poll.
      void client.invalidateQueries({ queryKey: queryKeys.calls.active() });

      // History list — debounced invalidate (bursts of webhooks arrive together).
      if (!invalidateTimer) {
        invalidateTimer = setTimeout(() => {
          invalidateTimer = null;
          void client.invalidateQueries({ queryKey: queryKeys.calls.lists() });
        }, LIST_INVALIDATE_DEBOUNCE_MS);
      }
    };

    const stream = openSharedSseStream<CallEvent>("calls", {
      url: `${env.apiBaseUrl}${CALLS_STREAM_PATH}`,
      getToken: getIdToken,
      parse: parseCallFrame,
      onEvent: applyEvent,
    });

    return () => {
      stream.close();
      if (invalidateTimer) clearTimeout(invalidateTimer);
    };
  }, [enabled, qc]);
}
