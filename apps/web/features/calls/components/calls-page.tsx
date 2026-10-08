"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { WzStatCard } from "@/components/workiz/page-parts";
import type { WzDateRange } from "@/components/workiz/date-range-picker";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { activeCallTags } from "@/features/call-tags/lib";
import { accountToday } from "@/features/reports/report-dates";
import { useCallLogData } from "../calls-page-data";
import { useCallsCount, useCallsList, useCallsSummary } from "../hooks";
import { useCallStream } from "../use-call-stream";
import { toCallsFilter, type CallFilterChip, type CallFilterKind } from "../call-filters";
import { DEFAULT_CALLS_PRESET, callsPresetRange, dayRangeToInstants } from "../date-presets";
import { callsKpis } from "../kpis";
import { CallsTable, CallsTableSkeleton } from "./calls-table";
import { CallsFilterRow } from "./calls-filters";
import { CallsFieldsMenu } from "./calls-fields-menu";
import { CallMonitoring } from "./call-monitoring";
import { PhoneHeader, PhoneTabs } from "./phone-shell";

/** Workiz's page-size box on the call log (`_pageSize`: 5, 10, 20, 25, 50, 100; it opens on 10). */
const CALLS_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;

/** How long the Search box waits after the last key. */
const SEARCH_DEBOUNCE_MS = 300;

/** Today's window, Workiz's opening choice. */
function todayRange(): WzDateRange {
  return { preset: DEFAULT_CALLS_PRESET, ...callsPresetRange(DEFAULT_CALLS_PRESET, accountToday())! };
}

/**
 * The call log as Workiz draws "Workiz Phone" (`/root/callsReport/`,
 * callspage_wz_01): the heading with the workspace's number, the section's
 * tabs, "+ Add filter" and the date box (Today), the stat cards, the grey
 * strip — Search, the headset with the live count, page size, Fields — then
 * the grid and the pager.
 *
 * Everything the filters, the search and the date box say is a parameter of
 * `GET /telephony/calls` (and of its count and summary), so the cards, the
 * rows and "of N" always describe the same calls.
 */
export function CallsPage() {
  const { can } = usePermissions();
  const denied = useDenied();

  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);
  const [chips, setChips] = useState<CallFilterChip[]>([]);
  const [openKind, setOpenKind] = useState<CallFilterKind | null>(null);
  const [range, setRange] = useState<WzDateRange>(todayRange);

  // The server matches numbers: what is typed is searched by its digits.
  const filter = useMemo(
    () => toCallsFilter(chips, { number: search.replace(/[^\d+]/g, "") || undefined, ...dayRangeToInstants(range) }),
    [chips, search, range],
  );

  const [pageSize, setPageSize] = usePageSize("calls", { sizes: CALLS_PAGE_SIZES, fallback: 10 });
  const canView = can("calls");
  const query = useCallsList(filter, pageSize);
  const count = useCallsCount(filter);
  const summary = useCallsSummary(filter, canView);
  const pager = usePager(pagedSource(query), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ filter, pageSize }),
  });
  const calls = useMemo(() => {
    // Dedupe inside the page: an SSE-driven refetch can shift rows, and the
    // same call would otherwise land twice under one React key.
    const seen = new Set<string>();
    return pager.items.filter((call) => {
      if (seen.has(call.callSid)) return false;
      seen.add(call.callSid);
      return true;
    });
    // The page's own rows: turning to page 2 changes them without changing
    // the query's data, which already holds both pages.
  }, [pager.items]);

  // The live calls (the headset's count), the catalogs the rows print from
  // and the number pill. The call-tag catalog sits behind `settings.view`.
  const data = useCallLogData();
  const tagOptions = activeCallTags(data.callTags);
  // Real-time updates while the page is open.
  useCallStream(canView);

  // One skeleton, then the log whole: the rows wait for what they print and
  // for the numbers over and under them (cards, "of N"); the filter row, the
  // cards and the strip are drawn in that same frame and stay; the rows
  // start over when the filters change, like any new list.
  const allIn = data.allIn && settled(query) && settled(count) && settled(summary);
  const pageShown = usePageReady(allIn);
  const rowsShown = usePageReady(allIn, JSON.stringify({ filter, pageSize }));

  const kpis = callsKpis({ count: count.data, summary: summary.data, showMoney: can("financials", "view") });

  if (denied("calls")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-wz-caption">You don&apos;t have permission to view calls.</p>
      </div>
    );
  }

  return (
    // The page scrolls itself, as Workiz's main container does: the grid's
    // header sticks to its top, and a wide grid scrolls sideways under
    // controls that hold still (`sticky left-0`).
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="calls-scroller">
      <PhoneHeader number={pageShown ? data.mainNumber : undefined} />
      <PhoneTabs />

      <div className={cn(!pageShown && "invisible")} data-testid="calls-controls">
        <CallsFilterRow
          chips={chips}
          onChipsChange={setChips}
          openKind={openKind}
          onOpenKind={setOpenKind}
          callTags={tagOptions}
          range={range}
          onRangeChange={setRange}
        />

        {/* The stat cards: Workiz's five less Dispatcher score (no source),
            each from a real number or not drawn. Each keeps Workiz's size —
            a fifth of the row, 16px apart — so fewer cards leave the room
            empty rather than stretch. 25px under the filters. */}
        <div className="sticky left-0 flex h-[113px] gap-4 px-5 pt-[25px]">
          {kpis.map((k) => (
            <WzStatCard
              key={k.id}
              label={k.label}
              value={k.value}
              aside={k.aside}
              alert={k.alert}
              className="h-[88px] max-w-[calc((100%-64px)/5)]"
            />
          ))}
        </div>

        <WzListToolbar className="sticky left-0 mt-[25px] gap-x-2.5 px-[21px]">
          <WzSearchBox value={searchText} onChange={setSearchText} inputMode="search" />
          <CallMonitoring />
          <div className="ml-auto flex items-center gap-4">
            <WzPageSizeSelect value={pageSize} onChange={setPageSize} sizes={CALLS_PAGE_SIZES} />
            <CallsFieldsMenu />
          </div>
        </WzListToolbar>
      </div>

      {/* A tag is matched while walking the log, not looked up in an index —
          over a long window an uncommon tag can read a long way back for one
          page. Today's window keeps it quick; a wide one says so. */}
      {pageShown && filter.tagId && range.preset !== "today" && range.preset !== "yesterday" ? (
        <p className="sticky left-0 px-5 py-2 text-xs text-wz-caption">
          Tag search reads the log newest-first — a shorter date range keeps it quick.
        </p>
      ) : null}

      <div className="flex-1">
        {!rowsShown ? (
          <CallsTableSkeleton />
        ) : (
          <>
            <CallsTable
              calls={calls}
              // A filtered page is filled by walking the log newest-first, and
              // the server stops after a bounded stretch. An empty page with a
              // cursor means "not in the part read so far" — saying "No Calls
              // Found" there would be a lie, so it offers to read on instead.
              empty={query.hasNextPage ? "No calls yet in the stretch searched" : "No Calls Found"}
            />
            {calls.length === 0 && query.hasNextPage ? (
              <div className="sticky left-0 flex flex-col items-center gap-2 py-6 text-center">
                <p className="text-sm text-wz-caption">
                  The log is searched newest-first, a stretch at a time. Keep searching to read further back, or narrow
                  the date range.
                </p>
                <Button
                  variant="outline"
                  disabled={query.isFetchingNextPage}
                  // A move, not just a fetch: otherwise the stretch read would
                  // land in the cache while the screen stayed empty.
                  onClick={() => void pager.next()}
                >
                  {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Keep searching"}
                </Button>
              </div>
            ) : null}
            <WzPager pager={pager} className="sticky left-0" />
          </>
        )}
      </div>
    </div>
  );
}
