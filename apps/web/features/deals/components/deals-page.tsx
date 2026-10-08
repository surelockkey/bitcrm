"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search, TriangleAlert, X } from "lucide-react";
import type { Contact, Deal, PersonName } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager, type Pager } from "@/lib/paging/use-pager";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { DEFAULT_TZ } from "@/lib/timezone";
import { useDealCounts, useDealsPage, useUserMap, type DirectoryUser } from "../hooks";
import type { DealCounts } from "../api";
import { mergeIncluded } from "../included";
import { useContactsByIds } from "@/features/clients/hooks";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import {
  EMPTY_JOBS_LIST_STATE,
  JOBS_LIST_CAPS,
  JOBS_SEARCH_MAX,
  toCountsParams,
  toListParams,
  toSearchCountsParams,
  type JobsListState,
} from "../query-params";
import { jobTabLabel, tabCount, type JobTab } from "../lib";
import { JobSuperStatus } from "@bitcrm/types";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { activeJobTypes } from "@/features/job-types/lib";
import { useJobTags } from "@/features/job-tags/hooks";
import { activeJobTags } from "@/features/job-tags/lib";
import { useJobFieldsStore } from "../fields-store";
import { filterAreas, orderTechs, type FilterCatalogs } from "../job-filters";
import { canGoNext, pageText, showingText, withSearchedTab } from "../list-numbers";
import { DealsTable, DealsTableSkeleton } from "./deals-table";
import { DealQuickView } from "./deal-quick-view";
import { FieldsMenu } from "./fields-menu";
import { JobsFilterControl } from "./jobs-filter-control";

/** Workiz's five tabs (list_01). Done and Canceled are reached through Filter results → STATUS. */
const WORKIZ_TABS: JobTab[] = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
  "unscheduled",
];

/** Workiz's page-size select offers these (list_01 `select._pageSize`). */
const JOBS_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;

/** How long the Search box waits after the last key — Workiz fires ~300ms after it. */
const SEARCH_DEBOUNCE_MS = 300;

const caps = JOBS_LIST_CAPS;

/** The last whole frame of the grid: what stays on screen while the next search or page comes in. */
interface Frame {
  /** The list without its search text — the frame stands only for that same list. */
  base: string;
  rows: Deal[];
  contacts: Map<string, Contact>;
  clientNames: Map<string, PersonName>;
  pager: Pager<Deal>;
  /** The tab numbers the frame was drawn with. */
  counts: DealCounts | undefined;
}

/**
 * The jobs list, as Workiz draws `/root/jobs/` (list_01_submitted): the
 * "Filter results" control with "+ Create New" beside it, the five status
 * tabs with their counts, a grey strip holding the Search box, "Show unpaid
 * jobs", the page size and "Fields", then the grid and Workiz's pager.
 *
 * Everything — the Search box's text included — is a parameter of
 * `GET /deals` (`toListParams`): the server searches inside the tab and the
 * filters and pages the result, as Workiz's own list does.
 */
export function DealsPage() {
  const { can } = usePermissions();
  const denied = useDenied();
  const router = useRouter();
  const jobTypesQuery = useJobTypes();
  const jobTagsQuery = useJobTags();
  const { data: companies } = useBusinessProfiles();
  const { data: serviceAreas, isLoading: areasLoading } = useServiceAreas();

  const [state, setState] = useState<JobsListState>(EMPTY_JOBS_LIST_STATE);
  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);
  const [openId, setOpenId] = useState<string | null>(null);
  const visibleFields = useJobFieldsStore((s) => s.visible);
  const fieldOrder = useJobFieldsStore((s) => s.order);

  // What the server is asked for: the controls, with the search text as it
  // stood 300ms after the last key.
  const listState: JobsListState = useMemo(() => ({ ...state, search }), [state, search]);

  const [pageSize, setPageSize] = usePageSize("jobs", { sizes: JOBS_PAGE_SIZES });
  const listParams = useMemo(() => toListParams(listState, pageSize, caps), [listState, pageSize]);
  // The tabs' numbers: every tab without the search, and — while something is
  // typed — the same filters once more with it, for the open tab's chip.
  const countsParams = useMemo(() => toCountsParams(listState, caps), [listState]);
  const searchCountsParams = useMemo(() => toSearchCountsParams(listState, caps), [listState]);

  const dealsQuery = useDealsPage(listParams);
  const countsQuery = useDealCounts(countsParams);
  const searchedQuery = useDealCounts(searchCountsParams ?? countsParams, searchCountsParams !== null);
  const searching = searchCountsParams !== null;
  const counts = withSearchedTab(countsQuery.data, searching ? searchedQuery.data : undefined, state.tab);

  // Одна сторінка, а не все пройдене: таблиця показує рівно те, що просили,
  // і клієнтів під неї резолвимо теж лише на цю сторінку. A page can come
  // back short with more behind it (a closed status searched without a date
  // window runs out of reading budget); the pager numbers what it holds.
  const tabTotal = counts?.[state.tab];
  const pager = usePager(pagedSource(dealsQuery), {
    total: tabTotal === undefined ? undefined : tabTotal,
    totalIsFloor: state.tab !== "unscheduled" && counts?.atLeast?.includes(state.tab),
    pageSize,
    resetKey: JSON.stringify(listParams),
  });

  // The names the rows refer to travel with them (`included`): the
  // technicians assigned on the page and the clients of its jobs, names only.
  const names = useMemo(() => mergeIncluded(dealsQuery.data?.pages), [dealsQuery.data]);

  // The contacts: Workiz prints the client's number under the name, so they
  // are asked for whenever a column shows a number or an email.
  const contactIds = useMemo(() => pager.items.map((d) => d.contactId), [pager.items]);
  const needsContacts = Boolean(visibleFields.client || visibleFields.phone || visibleFields.email);
  const { map: contactMap, isLoading: contactsLoading } = useContactsByIds(contactIds, needsContacts);

  // The tech filter lists the roster, not whoever happens to be on this page.
  const { profiles: technicians } = useAllTechnicians();
  const rosterIds = useMemo(() => technicians.map((t) => t.userId), [technicians]);
  const { map: directory, isLoading: directoryLoading } = useUserMap(rosterIds);

  // What the table prints for a person. The technicians came with the rows,
  // so the Tech column is named on the first frame; the directory fills the
  // opt-in columns `included` does not carry.
  const tableNames = useMemo(() => {
    const m = new Map<string, DirectoryUser>(directory);
    for (const [id, person] of names.technicians) m.set(id, person);
    return m;
  }, [directory, names]);

  // Filter results' columns, from the catalogs — each in its own order, as
  // Workiz keeps them: the team in the order it joined, the tags in catalog
  // order, the areas A→Z without Workiz's default "All areas".
  const catalogs: FilterCatalogs = useMemo(
    () => ({
      techs: orderTechs(technicians, (id) => {
        const u = directory.get(id);
        return u ? `${u.firstName} ${u.lastName}`.trim() : id;
      }),
      tags: activeJobTags(jobTagsQuery.data).map((t) => ({ id: t.id, name: t.name, color: t.color })),
      jobTypes: activeJobTypes(jobTypesQuery.data).map((t) => ({ id: t.id, name: t.name })),
      areas: filterAreas(serviceAreas).map((a) => ({ name: a.name })),
      companies: (companies ?? []).map((c) => ({ id: c.id, name: c.active ? c.name : `${c.name} (archived)` })),
    }),
    [technicians, directory, jobTagsQuery.data, jobTypesQuery.data, serviceAreas, companies],
  );

  // The zone a visit was booked in: the job's own (Workiz), else its area's.
  const areaZone = useMemo(() => new Map((serviceAreas ?? []).map((a) => [a.id, a.timezone])), [serviceAreas]);
  const zoneOf = useCallback(
    (d: Deal) => d.jobTimezone || (d.serviceAreaId ? areaZone.get(d.serviceAreaId) : undefined),
    [areaZone],
  );

  // The server orders the rows (by visit, either way — the Scheduled header).
  const visible = pager.items;

  // Hold the first paint for everything the frame prints, and nothing else:
  // the rows, the tab numbers (the searched one too), the job types, the
  // client numbers under the names, the zones of the Scheduled cells, and an
  // opted-in Dispatcher column's names. Latched per list and per page: every
  // tab, filter, search and page is its own set, and starts with no rows at
  // all — a latch that survived it sent the page straight past the skeleton
  // into "No Jobs Found", which then filled in a moment later.
  const paintKey = `${JSON.stringify(listParams)}|${pager.page}`;
  const [painted, setPainted] = useState<string | null>(null);
  const rowsIn = !dealsQuery.isLoading;
  const countsIn = countsQuery.data !== undefined || countsQuery.isError;
  // The searched number belongs to this very text: an earlier one's, kept
  // on screen as placeholder data, is not an answer.
  const searchedIn = !searching || (searchedQuery.data !== undefined && !searchedQuery.isPlaceholderData) || searchedQuery.isError;
  const jobTypesIn = jobTypesQuery.data !== undefined || jobTypesQuery.isError;
  const namesIn = !(visibleFields.dispatcher && directoryLoading);
  const contactsIn = !(needsContacts && contactsLoading);
  // The same list with no search text: typing changes only the search (and
  // turning a page only the page), and Workiz keeps the rows it has on
  // screen until the new ones are in.
  const baseKey = JSON.stringify(toListParams({ ...listState, search: "" }, pageSize, caps));
  const [shown, setShown] = useState<Frame | null>(null);
  if (painted !== paintKey && rowsIn && countsIn && searchedIn && jobTypesIn && namesIn && contactsIn && !areasLoading) {
    setPainted(paintKey);
    setShown({ base: baseKey, rows: visible, contacts: contactMap, clientNames: names.clients, pager, counts });
  }
  const firstPaintPending = painted !== paintKey;
  // While a new search or page is out, the last whole frame of the same list stands.
  const held = firstPaintPending && shown?.base === baseKey ? shown : null;
  // Once drawn, the tabs stay: another tab or filter keeps them, numbers and all.
  const tabsShown = painted !== null;
  const tabCounts = held ? held.counts : counts;
  const isError = dealsQuery.isError;

  if (denied("deals", "view")) return <NoAccess entity="deals" />;

  const tableProps = {
    userMap: tableNames,
    namesLoading: directoryLoading,
    onOpen: (d: Deal) => setOpenId(d.id),
    onRowClick: (d: Deal) => router.push(`/deals/${d.id}`),
    visibleFields,
    order: fieldOrder,
    sort: state.sort,
    onSortScheduled: () => setState((s) => ({ ...s, sort: s.sort === "day_desc" ? "none" : "day_desc" })),
    zoneOf,
    accountZone: DEFAULT_TZ,
  } as const;

  return (
    <div className="flex flex-1 flex-col text-[#404040]">
      {/* Filter results + Create New: list_01 puts the control 20px in, 49px
          high, and the yellow pill 16px to its right, tops aligned. */}
      <div className="flex items-start gap-4 px-5 pt-[34px]">
        <JobsFilterControl state={state} onChange={setState} catalogs={catalogs} caps={caps} />
        {can("deals", "create") ? (
          <Button
            asChild
            className="h-8 shrink-0 gap-[3px] rounded-pill border-0 px-3 text-[13px] font-semibold tracking-[0.2px] text-primary-foreground hover:bg-primary/85"
          >
            <Link href="/deals/new">
              <Plus className="size-5" strokeWidth={2} />
              <span className="px-1">Create New</span>
            </Link>
          </Button>
        ) : null}
      </div>

      {/* Status tabs: 13px, the open one 600 with a 2px #3b4b52 underline,
          the rest 500 #566d76; a grey count chip beside each. */}
      <div
        className={cn("mt-[27px] flex overflow-x-auto border-b border-[#c4c4c4] pt-1", !tabsShown && "invisible")}
        role="tablist"
        aria-label="Job status"
      >
        {WORKIZ_TABS.map((t) => {
          const active = t === state.tab;
          // Searching, the open tab's chip counts what was found (Workiz);
          // `withSearchedTab` put that number in its place.
          const n = tabCounts
            ? tabCount(tabCounts, t)
            : " ";
          return (
            <button
              key={t}
              role="tab"
              aria-selected={active}
              onClick={() => setState((s) => ({ ...s, tab: t }))}
              className={cn(
                // -mb-px: the underline sits on the strip's own rule, as Workiz's does.
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-5 pt-2.5 pb-[7px] text-[13px] leading-[19px] tracking-[0.4px] whitespace-nowrap",
                active ? "border-[#3b4b52] font-semibold text-[#3b4b52]" : "border-transparent font-medium text-[#566d76] hover:text-[#3b4b52]",
              )}
            >
              {jobTabLabel(t)}
              {/* The tabs are drawn with their numbers, so a chip never grows under the reader. */}
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-border px-1.5 text-[11px] leading-4 font-semibold text-[#3b4b52] tabular-nums">
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* The grey strip: Search, Show unpaid jobs, and at the right the page size and Fields. */}
      <div className="flex min-h-[71px] flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-[#dddddd] bg-muted px-[21px] py-[15px]">
        <SearchBox value={searchText} onChange={setSearchText} />
        {caps.unpaid ? (
          <label className="flex h-10 cursor-pointer items-center gap-2 text-sm whitespace-nowrap text-[#404040]">
            <input
              type="checkbox"
              className="size-[13px] accent-[#6aa8ee]"
              checked={state.unpaid}
              onChange={(e) => setState((s) => ({ ...s, unpaid: e.target.checked }))}
            />
            Show unpaid jobs
          </label>
        ) : null}
        <div className="ml-auto flex items-center gap-4">
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <FieldsMenu />
        </div>
      </div>

      {/* Body: the grid runs edge to edge, as Workiz's does. */}
      <div className="flex-1">
        {held ? (
          <div aria-busy>
            <DealsTable deals={held.rows} contactMap={held.contacts} clientNames={held.clientNames} {...tableProps} />
            <JobsPagination pager={held.pager} />
          </div>
        ) : firstPaintPending ? (
          <DealsTableSkeleton visibleFields={visibleFields} order={fieldOrder} />
        ) : isError ? (
          <DealsError onRetry={() => dealsQuery.refetch()} isRetrying={dealsQuery.isFetching} />
        ) : (
          <>
            <DealsTable deals={visible} contactMap={contactMap} clientNames={names.clients} {...tableProps} />
            <JobsPagination pager={pager} />
          </>
        )}
      </div>

      <DealQuickView dealId={openId} open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}

/**
 * Workiz's table Search (list_01: 348×40, 1px #9ea6aa, radius 4, 13px text
 * between 44px sides, a magnifier at the left; blue border while focused;
 * a round × once there is text).
 */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-[348px] max-w-full">
      <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#3b4b52]" />
      <input
        aria-label="Search"
        placeholder="Search"
        maxLength={JOBS_SEARCH_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-[4px] border border-[#9ea6aa] bg-background px-11 text-[13px] leading-4 text-[#3b4b52] outline-none placeholder:text-[#9ea6aa] focus:border-[#6aa8ee]"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-[5px] grid size-[26px] -translate-y-1/2 place-items-center rounded-full bg-[#f3f6f7] text-[#768287] hover:text-[#3b4b52]"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Workiz's page-size select: 75×34 on the grey strip, 1px #ccc, radius 2, "50 ⌄". */
function PageSizeSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="relative h-[34px] w-[75px] rounded-chip border border-input bg-muted">
      <select
        aria-label="Rows per page"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-full w-full cursor-pointer appearance-none bg-transparent pr-7 pl-2.5 text-[13.86px] font-medium tracking-[0.5px] text-[#444444] outline-none"
      >
        {JOBS_PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-[#444444]" />
    </div>
  );
}

/**
 * Workiz's pager (list_07_bottom): "Showing 1 to 50 of 208 results" at the
 * left of a 64px bar; round ‹ › buttons either side of "Page 1 of 5" in its
 * middle. The cursor list cannot jump to page 7, so there are no numbers to
 * click — exactly Workiz's own control. A list the server did not count
 * says only what is on screen ("Showing 1 to 37 results", "Page 2").
 */
function JobsPagination({ pager }: { pager: Pager<Deal> }) {
  // list_07: the round buttons look the same on the first and last page —
  // #404040 on #fafafa, no fading — they simply do nothing there. The
  // glyphs are Workiz's thin 18px chevrons.
  const round =
    "grid size-[30px] place-items-center rounded-full bg-[#fafafa] text-[#404040] enabled:hover:bg-[#ededed] disabled:cursor-default";
  return (
    <div
      data-testid="list-pagination"
      className="relative flex h-16 items-center border-t-2 border-black/10 px-2.5 text-sm shadow-[0_0_15px_rgba(0,0,0,0.1)]"
    >
      <span className="tabular-nums">{showingText(pager)}</span>
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-[50px]">
        <button type="button" aria-label="Previous page" disabled={!pager.canPrev} onClick={() => pager.prev()} className={round}>
          <ChevronLeft className="size-[18px]" strokeWidth={1.5} />
        </button>
        <span className="tabular-nums whitespace-nowrap">{pageText(pager)}</span>
        <button
          type="button"
          aria-label="Next page"
          // The count knows the last page: no "Page 2 of 1" (audit L8).
          disabled={!canGoNext(pager)}
          onClick={() => void pager.next()}
          className={round}
        >
          <ChevronRight className="size-[18px]" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

function DealsError({ onRetry, isRetrying }: { onRetry: () => void; isRetrying: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border-y border-[#dddddd] py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="font-medium">Couldn&apos;t load jobs</div>
      <p className="max-w-xs text-sm text-muted-foreground">
        Something went wrong fetching the jobs. Check your connection and try again.
      </p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
