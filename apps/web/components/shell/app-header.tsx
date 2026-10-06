"use client";

import { Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUiStore } from "@/stores/ui-store";
import { usePermissions } from "@/features/auth/use-permissions";
import { cn } from "@/lib/utils";
import { SoftphoneControls } from "@/features/telephony/components/softphone-controls";
import { InboxHeaderButton } from "@/features/messaging/components/inbox-header-button";
import { NavUser } from "./nav-user";

export function AppHeader() {
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  // The inbox button and the user's name wait on who is signed in; drawn
  // before them, the search box slid left when they arrived. Out of sight
  // until then, the cluster is drawn once, whole.
  const { isLoading } = usePermissions();

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-topbar-border bg-topbar px-3">
      <SidebarTrigger className="text-muted-foreground" />

      <div className={cn("ml-auto flex items-center gap-2", isLoading && "invisible")}>
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="flex h-10 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted sm:w-64"
        >
          <Search className="size-4 shrink-0" />
          <span className="hidden flex-1 truncate text-left sm:inline">
            Search deals, contacts, people…
          </span>
          <kbd className="hidden rounded border bg-background px-1.5 font-mono text-xs sm:inline">
            ⌘K
          </kbd>
        </button>
        {/* Workiz order in the icon cluster: phone, then the Messages bubble. */}
        <SoftphoneControls />
        <InboxHeaderButton />
        <NavUser />
      </div>
    </header>
  );
}
