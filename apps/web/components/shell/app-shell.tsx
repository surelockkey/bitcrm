"use client";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { PageHistoryBar } from "./page-history";
import { CommandMenu } from "./command-menu";
import { LocationBroadcaster } from "@/features/technicians/components/location-broadcaster";
import { SoftphoneProvider } from "@/features/telephony/components/softphone-provider";
import { MessagingStreamProvider } from "@/features/messaging/components/messaging-stream-provider";
import { InboxSidebarCollapse } from "@/features/messaging/components/inbox-sidebar-collapse";

/** Authenticated app chrome: sidebar + header + command palette. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // h-svh bounds the shell to the viewport so pages built for internal
    // scrolling (flex-1 + overflow-y-auto) actually clip and scroll their own
    // content instead of growing the document. Pages without their own scroll
    // region still fall back to document scroll (overflow isn't clipped here).
    //
    // app-safe-area (globals.css) keeps the header out of the iOS status bar
    // and the bottom of those scroll areas off the home indicator, which is
    // what `viewport-fit: cover` in app/layout.tsx signs the app up for.
    <SidebarProvider className="h-svh app-safe-area">
      <AppSidebar />
      <SidebarInset className="min-h-0">
        <AppHeader />
        <PageHistoryBar />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
      <CommandMenu />
      {/* Streams a technician's live location while they're online (renders nothing). */}
      <LocationBroadcaster />
      {/* Twilio softphone: drives the Device from the phone on/off toggle and
          renders the floating dialer overlay. */}
      <SoftphoneProvider />
      {/* Inbox live updates (SSE) for the whole session; feeds the sidebar
          badge and any open thread (renders nothing). */}
      <MessagingStreamProvider />
      {/* The Inbox owns the screen: fold the navigation to its icon rail while
          it is open, unfold on the way out (renders nothing). */}
      <InboxSidebarCollapse />
    </SidebarProvider>
  );
}
