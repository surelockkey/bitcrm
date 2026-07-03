"use client";

import { useEffect } from "react";
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
  TECHNICIAN_NAV,
  visibleNavItems,
  type NavItem,
} from "@/lib/nav/nav-config";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUiStore } from "@/stores/ui-store";

export function CommandMenu() {
  const router = useRouter();
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const { can, isTechnician } = usePermissions();

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

  const items: NavItem[] = isTechnician
    ? TECHNICIAN_NAV
    : [
        OVERVIEW_ITEM,
        ...MAIN_NAV.flatMap((g) => visibleNavItems(g.items, (r) => can(r))),
        ...(can("settings") ? [SETTINGS_ITEM] : []),
      ];

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="sm:max-w-2xl">
      <Command>
        <CommandInput placeholder="Search pages…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => go(item.href)}
                >
                  <Icon />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
