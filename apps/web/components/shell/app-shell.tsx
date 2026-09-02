"use client";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { PageHistoryBar } from "./page-history";
import { CommandMenu } from "./command-menu";
import { LocationBroadcaster } from "@/features/technicians/components/location-broadcaster";
import { SoftphoneProvider } from "@/features/telephony/components/softphone-provider";

/** Authenticated app chrome: sidebar + header + command palette. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // h-svh bounds the shell to the viewport so pages built for internal
    // scrolling (flex-1 + overflow-y-auto) actually clip and scroll their own
    // content instead of growing the document. Pages without their own scroll
    // region still fall back to document scroll (overflow isn't clipped here).
    <SidebarProvider className="h-svh">
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
    </SidebarProvider>
  );
}
