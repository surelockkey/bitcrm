"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSidebar } from "@/components/ui/sidebar";

/** Routes where the Inbox owns the screen: the app sidebar folds to its icon rail, like Workiz. */
export const INBOX_ROUTE_PREFIX = "/messages";

export const isInboxRoute = (pathname: string | null | undefined) =>
  !!pathname && (pathname === INBOX_ROUTE_PREFIX || pathname.startsWith(`${INBOX_ROUTE_PREFIX}/`));

/** A client card (`/contacts/<id>`): its own left column wants the room the nav takes. */
const CLIENT_CARD_ROUTE = /^\/contacts\/[^/]+$/;

/** Settings bring their own left rail of sections; two rails side by side is one too many. */
const SETTINGS_ROUTE_PREFIX = "/settings";

const isSettingsRoute = (pathname: string) =>
  pathname === SETTINGS_ROUTE_PREFIX || pathname.startsWith(`${SETTINGS_ROUTE_PREFIX}/`);

/** Routes that own the screen: the Inbox, a client card and settings fold the nav to its icon rail. */
export const isSidebarFoldedRoute = (pathname: string | null | undefined) =>
  isInboxRoute(pathname) || (!!pathname && (CLIENT_CARD_ROUTE.test(pathname) || isSettingsRoute(pathname)));

/**
 * Folds the navigation sidebar while the Inbox, a client card or settings are open and
 * unfolds it again on the way out — only when this component did the folding, so a sidebar the
 * user collapsed themselves stays collapsed. Renders nothing; mounts inside
 * `SidebarProvider` (see `AppShell`). Mobile uses the sheet sidebar, which is
 * closed anyway, so nothing happens there.
 */
export function InboxSidebarCollapse() {
  const pathname = usePathname();
  const { open, setOpen, isMobile } = useSidebar();
  // The sidebar state we found on entering the Inbox, to restore on leaving.
  const foldedByUs = useRef<boolean | null>(null);
  const onInbox = isSidebarFoldedRoute(pathname);

  useEffect(() => {
    if (isMobile) return;
    if (onInbox) {
      if (foldedByUs.current === null && open) {
        foldedByUs.current = true;
        setOpen(false);
      }
      return;
    }
    if (foldedByUs.current) {
      foldedByUs.current = null;
      setOpen(true);
    }
    // `open` is intentionally not a dependency: reacting to it would re-fold a
    // sidebar the user expands while reading the Inbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onInbox, isMobile]);

  return null;
}
