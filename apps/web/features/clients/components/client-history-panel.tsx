"use client";

import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useContactTimeline, useUserMap } from "@/features/deals/hooks";
import {
  actorLabel,
  EntryRow,
  entryHaystack,
  FILTERS,
  matchesFilter,
  mentionedContactIds,
  useTimelineLookups,
  type TimelineFilter,
} from "@/features/deals/components/deal-timeline-panel";

/**
 * Workiz's History rail on the client card: every job's timeline as one
 * feed, each row naming its job, with the job timeline's filters and search.
 * Notes are read here and edited on the job they belong to.
 */
export function ClientHistoryPanel({
  contactId,
  open,
  onOpenChange,
}: {
  contactId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[400px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>History</SheetTitle>
          <SheetDescription className="sr-only">What happened on the client&apos;s jobs, newest first.</SheetDescription>
        </SheetHeader>
        {open ? <HistoryBody contactId={contactId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function HistoryBody({ contactId }: { contactId: string }) {
  const query = useContactTimeline(contactId);
  const { map: userMap } = useUserMap();
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [search, setSearch] = useState("");

  const entries = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const lookups = useTimelineLookups(useMemo(() => mentionedContactIds(entries), [entries]));

  const rows = useMemo(() => {
    let base = entries.filter((e) => matchesFilter(e, filter));
    const q = search.trim().toLowerCase();
    if (q) base = base.filter((e) => entryHaystack(e, lookups).includes(q));
    return [...base].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [entries, filter, search, lookups]);

  return (
    <>
      <div className="space-y-2 border-b px-4 py-3">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Filters</span>
          <Select value={filter} onValueChange={(v) => setFilter(v as TimelineFilter)}>
            <SelectTrigger className="h-9 w-full" aria-label="Filters">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8" aria-label="Search history" placeholder="Search history…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{search.trim() ? "Nothing matches your search." : "No activity yet."}</p>
        ) : (
          <ol className="space-y-3">
            {rows.map((row) => (
              <EntryRow
                key={row.id}
                entry={row}
                lookups={lookups}
                actor={actorLabel(row, userMap)}
                job={row.dealNumber ? { id: row.dealId, number: row.dealNumber } : undefined}
              />
            ))}
          </ol>
        )}

        {query.hasNextPage ? (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
          </Button>
        ) : null}
      </div>
    </>
  );
}
