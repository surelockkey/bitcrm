"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ConversationKind } from "@bitcrm/types";
import type { InboxView } from "./api";

/** What the Inbox keeps in its URL: the open thread and the category. */
export interface InboxUrlState {
  c?: string;
  view?: InboxView;
  kind?: ConversationKind;
}

/** The Inbox URL after `next`: keys it names are set or, when empty, dropped; "all" is the default view. */
export function inboxHref(pathname: string, search: string, next: InboxUrlState): string {
  const qs = new URLSearchParams(search);
  const apply = (key: string, value?: string) => (value ? qs.set(key, value) : qs.delete(key));
  if ("c" in next) apply("c", next.c);
  if ("view" in next) apply("view", next.view === "all" ? undefined : next.view);
  if ("kind" in next) apply("kind", next.kind);
  const s = qs.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/**
 * Moves the Inbox to another thread or category through the browser's own
 * history, which Next keeps `useSearchParams` in step with. The router would
 * ask the server for the page again on every click, and a click waited on that
 * answer — behind a busy dev server it never came and the thread never
 * changed. Replace, not push: the back button leaves the Inbox, as before.
 */
export function useInboxNavigate(): (next: InboxUrlState) => void {
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (next: InboxUrlState) => window.history.replaceState(null, "", inboxHref(pathname, params.toString(), next)),
    [pathname, params],
  );
}
