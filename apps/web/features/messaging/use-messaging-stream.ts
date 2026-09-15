"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";
import { queryKeys } from "@/lib/query-keys";
import { useMe } from "@/features/auth/use-me";
import { MESSAGING_EVENTS_PATH } from "./api";
import { applyRealtimeEvent } from "./cache";
import { openMessagingStream } from "./stream";
import { useMessagingStreamStore } from "./stream-store";

/**
 * One live stream per tab for the whole session (design §7.6), mounted in
 * the shell. Frames are patched straight into the query cache — inbox
 * tabs, open feeds, the badge counters — so nothing polls while it is up.
 * When it drops, the store flips `connected` off and the counters / feed
 * queries fall back to polling until it is back.
 */
export function useMessagingStream(enabled: boolean) {
  const qc = useQueryClient();
  const meId = useMe().data?.id;
  // Read inside the stream callback, so the connection need not be reopened
  // when the session resolves the user a moment after mount.
  const meRef = useRef(meId);
  useEffect(() => {
    meRef.current = meId;
  }, [meId]);
  const setConnected = useMessagingStreamStore((s) => s.setConnected);

  useEffect(() => {
    if (!enabled) return;

    const stream = openMessagingStream({
      url: `${env.apiBaseUrl}${MESSAGING_EVENTS_PATH}`,
      getToken: getIdToken,
      onEvent: (event) => applyRealtimeEvent(qc, event, meRef.current),
      onConnect: () => {
        setConnected(true);
        // Anything that happened while we were away is on the server, not
        // in a frame we missed: refresh what is on screen.
        void qc.invalidateQueries({ queryKey: queryKeys.messaging.all() });
      },
      onDisconnect: () => setConnected(false),
    });

    return () => {
      stream.close();
      setConnected(false);
    };
  }, [enabled, qc, setConnected]);
}
