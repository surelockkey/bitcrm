"use client";

import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUiStore } from "@/stores/ui-store";
import { NavUser } from "./nav-user";

export function AppHeader() {
  const { can } = usePermissions();
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
      <SidebarTrigger className="text-muted-foreground" />

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">
          Search deals, contacts, SKU…
        </span>
        <kbd className="hidden rounded border bg-background px-1.5 font-mono text-xs sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {can("deals", "create") ? (
          <Button asChild variant="brand" className="h-9 gap-1.5 px-3.5">
            <Link href="/deals">
              <Plus className="size-4" />
              <span className="hidden sm:inline">New Deal</span>
            </Link>
          </Button>
        ) : null}
        <NavUser />
      </div>
    </header>
  );
}
