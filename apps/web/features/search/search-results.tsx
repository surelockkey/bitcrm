"use client";

import type { SearchGroup, SearchHit } from "@bitcrm/types";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { SEARCH_TYPE_META } from "./search-meta";

interface SearchResultsProps {
  groups: SearchGroup[];
  onSelect: (hit: SearchHit) => void;
}

/**
 * Renders permission-filtered search hits, one CommandGroup per entity type.
 * cmdk filtering is disabled by the parent (server already ranked/filtered), so
 * every item here is shown as-is in relevance order.
 */
export function SearchResults({ groups, onSelect }: SearchResultsProps) {
  return (
    <>
      {groups.map((group) => {
        const meta = SEARCH_TYPE_META[group.type];
        const Icon = meta.icon;
        return (
          <CommandGroup
            key={group.type}
            heading={`${meta.label}${group.total > group.items.length ? ` (${group.total})` : ""}`}
          >
            {group.items.map((hit) => (
              <CommandItem
                key={`${hit.type}:${hit.entityId}`}
                // Unique value so cmdk keys/highlights correctly; filtering is off.
                value={`${hit.type}:${hit.entityId}`}
                onSelect={() => onSelect(hit)}
                className="gap-2"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{hit.title}</span>
                  {hit.subtitle ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {hit.subtitle}
                    </span>
                  ) : null}
                </div>
                {hit.badges.length ? (
                  <span className="ml-auto hidden shrink-0 gap-1 sm:flex">
                    {hit.badges.slice(0, 2).map((badge) => (
                      <span
                        key={badge}
                        className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground"
                      >
                        {badge.replace(/_/g, " ")}
                      </span>
                    ))}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        );
      })}
    </>
  );
}
