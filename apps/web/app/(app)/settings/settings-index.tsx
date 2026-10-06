"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { SETTINGS_SECTIONS } from "./sections";

/**
 * The settings landing list — choose a section, then edit it.
 *
 * Which sections show depends on the permissions, so until they are in the
 * list is one skeleton: drawn early, it stood at its one unguarded row and
 * then grew to twenty under the reader.
 */
export function SettingsIndex() {
  const { can, isLoading } = usePermissions();
  const visible = SETTINGS_SECTIONS.filter((s) => !s.resource || can(s.resource));

  if (isLoading) {
    return (
      <div className="max-w-2xl">
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="divide-y rounded-lg border">
        {visible.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50"
            >
              <span className="flex size-9 items-center justify-center rounded-md border bg-muted/40">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{section.label}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {section.description}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
