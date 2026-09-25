"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";
import { queryKeys } from "@/lib/query-keys";
import { openSharedSseStream } from "@/lib/shared-sse-stream";
import { createDealChangeBatcher, DEALS_STREAM_PATH, parseDealFrame } from "./live";
import { useDealsStreamStore } from "./stream-store";

/** Long enough to gather one save's frames, short enough to feel instant. */
const CHANGE_BATCH_MS = 500;

/**
 * One live jobs stream for the whole session — shared by every tab of the
 * browser (`openSharedSseStream`) — mounted in the shell.
 * A change refetches the job queries on screen — the list, the boards, an
 * open job — so the boards stop polling while it is up; when it drops, the
 * store flips `connected` off and they poll again until it is back.
 */
export function useDealsStream(enabled: boolean) {
  const qc = useQueryClient();
  const setConnected = useDealsStreamStore((s) => s.setConnected);

  useEffect(() => {
    if (!enabled) return;

    const batcher = createDealChangeBatcher(qc, CHANGE_BATCH_MS);
    const stream = openSharedSseStream("deals", {
      url: `${env.apiBaseUrl}${DEALS_STREAM_PATH}`,
      getToken: getIdToken,
      parse: parseDealFrame,
      onEvent: () => batcher.changed(),
      onConnect: () => {
        setConnected(true);
        // Whatever changed while we were away came in no frame: refresh.
        void qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
      },
      onDisconnect: () => setConnected(false),
    });

    return () => {
      stream.close();
      batcher.dispose();
      setConnected(false);
    };
  }, [enabled, qc, setConnected]);
}
