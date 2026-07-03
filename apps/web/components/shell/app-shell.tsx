"use client";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { CommandMenu } from "./command-menu";

/** Authenticated app chrome: sidebar + header + command palette. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
      <CommandMenu />
    </SidebarProvider>
  );
}
