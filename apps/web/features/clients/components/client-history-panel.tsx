"use client";

import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { WzRailPanel } from "@/components/workiz/rail";
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
 * Workiz's History panel on the client page (pg_contact_wz_269669_12): the
 * outlined "Filters" select (All, Notes, Activities, Calls) and every job's
 * timeline as one feed, newest first, each row naming its job. Ours adds a
 * search under the filter. Notes are read here and edited on the job they
 * belong to.
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
  if (!open) return null;
  return (
    <WzRailPanel variant="plain" aria-label="History" title="History" onClose={() => onOpenChange(false)} className="max-md:w-full">
      <HistoryBody contactId={contactId} />
    </WzRailPanel>
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
    <div className="px-4 pb-6">
      {/* pg_contact_wz_269669_12: a 42px box, 1px #9ea6aa, r4; "Filters" notched in at 11px; "All" 13px #768287. */}
      <div className="relative mt-[26px]">
        <span className="pointer-events-none absolute -top-2 left-2 z-10 bg-white px-1 text-[11px] leading-4 tracking-[0.4px] text-foreground">Filters</span>
        <Select value={filter} onValueChange={(v) => setFilter(v as TimelineFilter)}>
          <SelectTrigger className="h-[42px] w-full rounded-[4px] border-wz-outline text-[13px] text-wz-outline-label" aria-label="Filters">
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
      </div>
      {/* Ours: a search over the feed. */}
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground" aria-hidden />
        <input
          aria-label="Search history"
          placeholder="Search history"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-[4px] border border-wz-outline bg-white pr-3 pl-10 text-[13px] leading-4 text-foreground outline-none placeholder:text-wz-outline focus:border-wz-link"
        />
      </div>

      <div className="mt-7">
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <p className="mt-[180px] text-center text-sm leading-[21px] tracking-[0.4px] text-foreground">
            {search.trim() ? "Nothing matches your search." : "This client doesn’t have any records"}
          </p>
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
          <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
