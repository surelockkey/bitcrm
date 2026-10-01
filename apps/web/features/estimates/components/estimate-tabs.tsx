"use client";

import Link from "next/link";
import { ChevronDown, Copy, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Oldest first — "Estimate 1" is the first one made, as in Workiz. */
export function byCreated<T extends { createdAt: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** What Workiz calls an estimate in its tabs and its list: the name it was given, or "Estimate N". */
export const optionLabel = (e: { name?: string | null }, index: number): string => e.name?.trim() || `Estimate ${index + 1}`;

/**
 * The job's estimates as Workiz's tabs on an estimate's page: "Estimate 1 ·
 * Estimate 2 · Add estimate ▾", the open one underlined in ink. Each tab is a
 * link to that estimate's own page.
 */
export function EstimateTabs({
  estimates,
  currentId,
  canCreate,
  onNew,
  onCopy,
  copying,
}: {
  estimates: readonly { id: string; name?: string | null; createdAt: string }[];
  currentId: string;
  canCreate: boolean;
  onNew: () => void;
  /** Make a copy of the open estimate. */
  onCopy?: () => void;
  copying?: boolean;
}) {
  return (
    <div role="tablist" aria-label="Estimates" className="flex min-w-0 flex-1 flex-wrap items-end">
      {estimates.map((e, i) => {
        const selected = e.id === currentId;
        return (
          <Link
            key={e.id}
            href={`/estimates/${e.id}`}
            role="tab"
            aria-selected={selected}
            className={cn(
              "-mb-px border-b-[3px] px-5 py-2.5 text-[15px] transition-colors",
              selected ? "border-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {optionLabel(e, i)}
          </Link>
        );
      })}
      {canCreate ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1 px-4 py-2.5 text-[15px] font-medium text-brand hover:underline">
              <Plus className="size-4" /> Add estimate <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onNew}>
              <Plus /> New estimate
            </DropdownMenuItem>
            {onCopy ? (
              <DropdownMenuItem disabled={copying} onSelect={onCopy}>
                <Copy /> Make a copy
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
