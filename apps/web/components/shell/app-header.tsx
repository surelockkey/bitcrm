"use client";

import { Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUiStore } from "@/stores/ui-store";
import { SoftphoneControls } from "@/features/telephony/components/softphone-controls";
import { NavUser } from "./nav-user";

export function AppHeader() {
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
      <SidebarTrigger className="text-muted-foreground" />

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="flex h-8 items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted sm:w-56"
        >
          <Search className="size-4 shrink-0" />
          <span className="hidden flex-1 truncate text-left sm:inline">
            Search deals, contacts, SKU…
          </span>
          <kbd className="hidden rounded border bg-background px-1.5 font-mono text-xs sm:inline">
            ⌘K
          </kbd>
        </button>
        <SoftphoneControls />
        <NavUser />
      </div>
    </header>
  );
}
