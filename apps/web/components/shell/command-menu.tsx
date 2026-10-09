"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  MAIN_NAV,
  OVERVIEW_ITEM,
  SETTINGS_ITEM,
  TEAM_NAV,
  TECHNICIAN_NAV,
  visibleNavItems,
  type NavItem,
} from "@/lib/nav/nav-config";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUiStore } from "@/stores/ui-store";
import { useGlobalSearch } from "@/features/search/use-global-search";
import { SearchResults } from "@/features/search/search-results";
import { GLOBAL_SEARCH_TYPES } from "@/features/search/search-meta";
import type { SearchHit } from "@bitcrm/types";

export function CommandMenu() {
  const router = useRouter();
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const { can, isTechnician } = usePermissions();

  const [query, setQuery] = useState("");
  // Everything but items: as in Workiz, the global search finds no products.
  const { data, isSearching } = useGlobalSearch(query, {
    mode: "typeahead",
    limit: 5,
    types: [...GLOBAL_SEARCH_TYPES],
  });

  const showResults = query.trim().length >= 2;
  // An older search service that answers them anyway: still not shown.
  const groups = (data?.groups ?? []).filter((g) => GLOBAL_SEARCH_TYPES.includes(g.type));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUiStore.getState().commandOpen);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const navItems: NavItem[] = isTechnician
    ? visibleNavItems(TECHNICIAN_NAV, (r) => can(r))
    : [
        OVERVIEW_ITEM,
        ...MAIN_NAV.flatMap((g) => visibleNavItems(g.items, (r) => can(r))),
        // Team and Settings are not sidebar rows (Workiz keeps them under
        // Settings and the avatar menu); the palette still jumps to them.
        ...visibleNavItems(TEAM_NAV, (r) => can(r)),
        ...(can("settings") ? [SETTINGS_ITEM] : []),
      ];

  const close = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery("");
  };

  const goTo = (href: string) => {
    close(false);
    router.push(href);
  };

  const goToHit = (hit: SearchHit) => goTo(hit.url ?? "/");

  return (
    <CommandDialog open={open} onOpenChange={close} className="sm:max-w-2xl">
      {/* Filtering is server-side (permission-aware + ranked), so disable cmdk's. */}
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search deals, contacts, people…"
        />
        <CommandList>
          <CommandEmpty>
            {isSearching ? "Searching…" : "No results found."}
          </CommandEmpty>

          {showResults ? (
            <SearchResults groups={groups} onSelect={goToHit} />
          ) : (
            <CommandGroup heading="Navigate">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={item.label}
                    onSelect={() => goTo(item.href)}
                  >
                    <Icon />
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
