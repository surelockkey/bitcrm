"use client";

import { useEffect } from "react";
import { sendHeartbeat } from "./api";

/** The server counts a user online for five minutes after their last request; a beat a minute keeps a reader on. */
export const HEARTBEAT_MS = 60_000;

/**
 * Admin → Users "Online": every signed-in request marks its user active, and
 * someone reading a page makes none — so the open tab says it is still in
 * use, once a minute and only while it is in view (a tab left in the
 * background goes offline five minutes later). Coming back into view beats
 * at once, but never twice inside half a minute however often the tabs flick.
 */
export function usePresenceHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let last = -Infinity;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < HEARTBEAT_MS / 2) return;
      last = now;
      sendHeartbeat().catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [enabled]);
}
