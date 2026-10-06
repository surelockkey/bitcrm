"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { settingsGroupId, visibleSettingsGroups } from "./sections";

/**
 * GitHub-style left rail: pick a settings section, edit it on the right. The
 * links sit under the same blocks as the settings page, each block named.
 */
export function SettingsSidebar() {
  const pathname = usePathname();
  const { can, isLoading } = usePermissions();

  const groups = visibleSettingsGroups((r) => can(r));

  return (
    // Which sections the reader may open lands a beat after the page paints:
    // out of sight until then, the rail is drawn once rather than growing.
    <nav className={cn("flex shrink-0 flex-col gap-4 md:w-56", isLoading && "invisible")}>
      {groups.map((group) => {
        const labelId = settingsGroupId("settings-rail", group);
        return (
          <div key={group.label} role="group" aria-labelledby={labelId} className="flex flex-col gap-0.5">
            <p id={labelId} className="px-3 pb-1 text-xs font-medium text-muted-foreground">
              {group.label}
            </p>
            {group.sections.map((section) => {
              const active = pathname === section.href;
              const Icon = section.icon;
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {section.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
