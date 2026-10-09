"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, TriangleAlert } from "lucide-react";
import type { Contact, Deal, PersonName } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { WzListToolbar, WzPageSizeSelect, WzPager, WzSearchBox, WzTabBar, wzPagerCanNext } from "@/components/workiz";
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
import { personName } from "../person-name";
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
import { withSearchedTab } from "../list-numbers";
import { DealsTable, DealsTableSkeleton } from "./deals-table";
import { Skeleton } from "@/components/ui/skeleton";
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

/** About the width of each tab's label and chip (13px 500), for the strip's placeholders. */
const TAB_PLACEHOLDER_WIDTHS = [100, 105, 97, 191, 118] as const;

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
 * jobs", the page size and "Fields", then the grid and Workiz's pager — the
 * tabs, strip, search, page size and pager are the kit's (components/workiz).
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
  const { ref: scrollerRef, width: viewWidth } = useClientWidth<HTMLDivElement>();
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
      // Named as Workiz names them: "(2) TX - Daniel Munoz" (`personName`).
      techs: orderTechs(technicians, (id) => personName(directory.get(id)) ?? id),
      tags: activeJobTags(jobTagsQuery.data).map((t) => ({ id: t.id, name: t.name, color: t.color })),
      jobTypes: activeJobTypes(jobTypesQuery.data).map((t) => ({ id: t.id, name: t.name })),
      // With Workiz's chip colour, where the area has one.
      areas: filterAreas(serviceAreas).map((a) => ({ name: a.name, color: a.color })),
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
    viewWidth,
  } as const;

  return (
    // The page scrolls itself, inside the shell, the way Workiz's main
    // container does: the top bar stays put, and the grid's header sticks to
    // the top while 50 tall rows go under it (audit L1). It scrolls sideways
    // too, for a wide set of columns — the controls above the grid hold
    // still (`sticky left-0`), only the grid moves.
    <div ref={scrollerRef} className="flex min-h-0 flex-1 flex-col overflow-auto text-[#404040]" data-slot="jobs-scroller">
      {/* Filter results + Create New: list_01 puts the control 20px in, 49px
          high, and the yellow pill 16px to its right, tops aligned. */}
      <div className="sticky left-0 flex items-start gap-4 px-5 pt-[34px]">
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

      {/* Status tabs: the kit's small tabs (13px, the open one 600 with a 2px
          ink bar over the row's #c4c4c4 rule, the rest 500 slate; a grey
          count chip beside each), 4px under the control as in list_01. */}
      <div className="sticky left-0 mt-[27px] shrink-0">
        {/* Until its numbers are in, the strip is held by five grey tabs over
            its own rule — Workiz has its tabs up before the rows (audit L19).
            They go in the frame the strip shows. Beside the strip, not in it:
            its overflow would clip the rule. */}
        {!tabsShown ? (
          <div aria-hidden data-slot="tabs-placeholder" className="absolute inset-0 flex items-center border-b border-[#c4c4c4] pt-1">
            {TAB_PLACEHOLDER_WIDTHS.map((w, i) => (
              <Skeleton key={i} className="mx-5 h-4" style={{ width: w }} />
            ))}
          </div>
        ) : null}
        <WzTabBar
          variant="small"
          aria-label="Job status"
          className={cn("pt-1", !tabsShown && "invisible")}
          tabs={WORKIZ_TABS.map((t) => ({
            value: t,
            label: jobTabLabel(t),
            // Searching, the open tab's chip counts what was found (Workiz);
            // `withSearchedTab` put that number in its place. The tabs are
            // drawn with their numbers, so a chip never grows under the reader.
            count: tabCounts ? tabCount(tabCounts, t) : " ",
          }))}
          value={state.tab}
          onValueChange={(t) => setState((s) => ({ ...s, tab: t as JobTab }))}
        />
      </div>

      {/* The grey strip: Search, Show unpaid jobs, and at the right the page size and Fields. */}
      <WzListToolbar className="sticky left-0 shrink-0">
        <WzSearchBox value={searchText} onChange={setSearchText} maxLength={JOBS_SEARCH_MAX} />
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
          <WzPageSizeSelect value={pageSize} sizes={JOBS_PAGE_SIZES} onChange={setPageSize} />
          <FieldsMenu />
        </div>
      </WzListToolbar>

      {/* Body: the grid runs edge to edge, as Workiz's does; under it the
          kit's pager ("Showing 1 to 50 of 208 results", ‹ "Page 1 of 5" ›),
          which rests › on the counted last page (audit L8). */}
      <div className="flex-1">
        {held ? (
          <div aria-busy>
            <DealsTable deals={held.rows} contactMap={held.contacts} clientNames={held.clientNames} {...tableProps} />
            <WzPager pager={{ ...held.pager, canNext: wzPagerCanNext(held.pager) }} className="sticky left-0 w-full" />
          </div>
        ) : firstPaintPending ? (
          <DealsTableSkeleton visibleFields={visibleFields} order={fieldOrder} />
        ) : isError ? (
          <DealsError onRetry={() => dealsQuery.refetch()} isRetrying={dealsQuery.isFetching} />
        ) : (
          <>
            <DealsTable deals={visible} contactMap={contactMap} clientNames={names.clients} {...tableProps} />
            <WzPager pager={{ ...pager, canNext: wzPagerCanNext(pager) }} className="sticky left-0 w-full" />
          </>
        )}
      </div>

      <DealQuickView dealId={openId} open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}

/**
 * An element's inner width, kept current. 0 where nothing is laid out (jsdom),
 * so a consumer falls back to its own width.
 */
function useClientWidth<T extends HTMLElement>() {
  // A callback ref: the element may arrive after the first render.
  const [el, ref] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, width };
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
