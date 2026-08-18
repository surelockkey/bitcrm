"use client";

import { useEffect } from "react";
import { formatPhone } from "@/lib/phone";
import { useSoftphoneStore } from "./softphone-store";

/**
 * Put the call in the browser tab's title.
 *
 * Only in the tab that actually has the call — the one with the audio. The
 * point of the title is to find that tab among a dozen others, so labelling
 * all of them would defeat it: it's read from this tab's own softphone rather
 * than from the server's "you are on a call", which is true everywhere.
 *
 * Next sets the title again on every navigation, so the title element is
 * watched: a route change during a call is re-overridden, and the title the
 * route wanted is remembered as the one to restore when the call ends.
 */
export function useCallTabTitle(): void {
  const callState = useSoftphoneStore((s) => s.callState);
  const call = useSoftphoneStore((s) => s.call);

  const who =
    call?.contactName ||
    (call?.number ? formatPhone(call.number) : "") ||
    "unknown";

  const title =
    callState === "incoming"
      ? `Incoming — ${who} · BitCRM`
      : callState === "active" || callState === "connecting"
        ? `Call with ${who} · BitCRM`
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
    const observer = node ? new MutationObserver(apply) : null;
    observer?.observe(node!, { childList: true });

    return () => {
      observer?.disconnect();
      // Only hand the title back if it's still ours — another effect may own
      // it by now.
      if (document.title === title) document.title = base;
    };
  }, [title]);
}
