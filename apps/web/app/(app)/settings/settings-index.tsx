"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { settingsGroupId, visibleSettingsGroups } from "./sections";

/**
 * The settings landing page — choose a section, then edit it. Laid out as
 * Workiz's: a heading per block (General Settings, Job Settings, Calls &
 * Text…) over that block's tiles, the tiles in the Reports hub's shape.
 *
 * Which sections show depends on the permissions, so until they are in the
 * page is one skeleton: drawn early, it stood at its one unguarded tile and
 * then grew to twenty under the reader.
 */
export function SettingsIndex() {
  const { can, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="max-w-5xl">
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  const groups = visibleSettingsGroups((r) => can(r));

  return (
    // Sized by the room the settings rail leaves it, not by the window.
    <div className="@container flex max-w-5xl flex-col gap-8">
      {groups.map((group) => {
        const headingId = settingsGroupId("settings-block", group);
        return (
          <section key={group.label} aria-labelledby={headingId}>
            <h2 id={headingId} className="mb-3 border-b pb-2 text-sm font-semibold tracking-tight">
              {group.label}
            </h2>
            <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
              {group.sections.map((section) => {
                const Icon = section.icon;
                return (
                  <li key={section.href} className="min-w-0">
                    <Link
                      href={section.href}
                      className="flex h-full items-center gap-3 rounded-lg border bg-card px-4 py-3.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{section.label}</span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">{section.description}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
