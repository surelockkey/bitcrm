"use client";

import { useEffect } from "react";
import { useActiveCall } from "@/features/calls/hooks";
import { counterparty, formatEndpoint, isLive } from "@/features/calls/lib";
import { useSoftphoneStore } from "./softphone-store";

/**
 * Put the call in the browser tab's title.
 *
 * A call is the one thing worth finding a tab for, and by the time you're
 * hunting for it you have half a dozen open — all of them saying "BitCRM".
 * Reads the call from the server, so every tab is labelled, not just the one
 * holding the audio.
 *
 * Next sets the title again on every navigation, so the title element is
 * watched: a route change during a call is re-overridden, and the title the
 * route wanted is remembered as the one to restore when the call ends.
 */
export function useCallTabTitle(): void {
  const callState = useSoftphoneStore((s) => s.callState);
  const { data: call } = useActiveCall(true);

  const ringingHere = callState === "incoming";
  const party = call ? counterparty(call) : null;
  const who = party?.name ?? formatEndpoint(party?.number) ?? "";
  const onACall = !!call?.callSid && isLive(call);

  const title = ringingHere
    ? `Incoming — ${who || "unknown caller"} · BitCRM`
    : onACall
      ? `Call with ${who || "unknown"} · BitCRM`
      : null;

  useEffect(() => {
    if (typeof document === "undefined" || !title) return;

    // What the page would be called if there were no call. Kept up to date so
    // navigating mid-call still restores the right title afterwards.
    let base = document.title;
    const apply = () => {
      if (document.title !== title) {
        base = document.title;
        document.title = title;
      }
    };
    apply();

    const node = document.querySelector("title");
    const observer = node
      ? new MutationObserver(apply)
      : null;
    observer?.observe(node!, { childList: true });

    return () => {
      observer?.disconnect();
      // Only hand the title back if it's still ours — another effect may own
      // it by now.
      if (document.title === title) document.title = base;
    };
  }, [title]);
}
