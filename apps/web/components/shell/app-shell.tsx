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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <PageHistoryBar />
        <div className="flex flex-1 flex-col">{children}</div>
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
