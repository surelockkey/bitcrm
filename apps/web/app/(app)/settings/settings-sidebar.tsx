"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { SETTINGS_SECTIONS } from "./sections";

/** GitHub-style left rail: pick a settings section, edit it on the right. */
export function SettingsSidebar() {
  const pathname = usePathname();
  const { can, isLoading } = usePermissions();

  const visible = SETTINGS_SECTIONS.filter((s) => !s.resource || can(s.resource));

  return (
    // Which sections the reader may open lands a beat after the page paints:
    // out of sight until then, the rail is drawn once rather than growing.
    <nav className={cn("flex shrink-0 flex-col gap-0.5 md:w-56", isLoading && "invisible")}>
      {visible.map((section) => {
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
    </nav>
  );
}
