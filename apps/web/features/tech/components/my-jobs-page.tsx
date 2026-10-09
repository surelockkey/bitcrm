"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import { JobSuperStatus, type Contact, type Deal, type PersonName } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WzPager, wzPagerCanNext } from "@/components/workiz/pager";
import { WzTabBar } from "@/components/workiz/tab-bar";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { cn } from "@/lib/utils";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager, type Pager } from "@/lib/paging/use-pager";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled } from "@/lib/use-page-ready";
import { useTeamChatCounters } from "@/features/messaging/hooks";
import { DEFAULT_TZ } from "@/lib/timezone";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useContactsByIds } from "@/features/clients/hooks";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { activeJobTypes } from "@/features/job-types/lib";
import { useJobTags } from "@/features/job-tags/hooks";
import { activeJobTags } from "@/features/job-tags/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";
import type { DealCounts } from "@/features/deals/api";
import { DEALS_POLL_MS, useDealCounts, useDealsPage, useUserMap, type DirectoryUser } from "@/features/deals/hooks";
import { mergeIncluded } from "@/features/deals/included";
import { jobTabLabel, tabCount, type JobTab } from "@/features/deals/lib";
import { withSearchedTab } from "@/features/deals/list-numbers";
import { filterAreas, type FilterCatalogs } from "@/features/deals/job-filters";
import {
  EMPTY_JOBS_LIST_STATE,
  JOBS_LIST_CAPS,
  JOBS_SEARCH_MAX,
  toCountsParams,
  toListParams,
  toSearchCountsParams,
  type JobsListState,
} from "@/features/deals/query-params";
import { useJobFieldsStore } from "@/features/deals/fields-store";
import { useDealsStreamStore } from "@/features/deals/stream-store";
import { DealsTable, DealsTableSkeleton } from "@/features/deals/components/deals-table";
import { DealQuickView } from "@/features/deals/components/deal-quick-view";
import { FieldsMenu } from "@/features/deals/components/fields-menu";
import { JobsFilterControl } from "@/features/deals/components/jobs-filter-control";
import { myJobHref, myJobsCatalogs, myJobsListState } from "../my-jobs-list";
import { PULL_THRESHOLD_PX, usePullToRefresh } from "../use-pull-to-refresh";
import { InstallHint } from "./install-hint";
import { TeamChatBadge } from "./team-chat-badge";

/** Workiz's five tabs (list_01); Done and Canceled are under Filter results → STATUS. */
const WORKIZ_TABS: JobTab[] = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
  "unscheduled",
];

/** Workiz's page sizes (list_01 `select._pageSize`) — the jobs list's own setting. */
const JOBS_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;

/** About the width of each tab's label and chip, for the strip's placeholders (as `/deals`). */
const TAB_PLACEHOLDER_WIDTHS = [100, 105, 97, 191, 118] as const;

/** Workiz fires its search ~300ms after the last key. */
const SEARCH_DEBOUNCE_MS = 300;

const caps = JOBS_LIST_CAPS;

/** The last whole frame: what stays on screen while the next search or page comes in. */
interface Frame {
  /** The list without its search text — the frame stands only for that same list. */
  base: string;
  rows: Deal[];
  contacts: Map<string, Contact>;
  clientNames: Map<string, PersonName>;
  pager: Pager<Deal>;
  counts: DealCounts | undefined;
}

/**
 * `/my-jobs` — a technician's jobs as Workiz's own technician sees them:
 * the jobs list (`/root/jobs/`, list_01) holding only the jobs they are on.
 * The same "Filter results" (without a TECHS column — the list is always
 * theirs), "+ Create New" for whoever may create jobs, the five status tabs
 * with their numbers, the grey strip with Search, "Show unpaid jobs", the
 * page size and "Fields", the jobs grid and Workiz's pager. A row opens the
 * job on the technician's own job page.
 *
 * Built from the jobs list's own pieces (`features/deals`), so a column, a
 * filter or a chip that changes there changes here. What is ours: the list
 * is asked for the viewer's id (a dispatcher opening this page has no scope
 * that narrows it), it refreshes itself every 30s while the live stream is
 * down (a job assigned while the phone was in a pocket shows up), a pull at
 * the top refreshes it on a phone, and the install hint for the home screen.
 */
export function MyJobsPage() {
  const { can, me } = usePermissions();
  const denied = useDenied();
  const router = useRouter();
  const meId = me?.id ?? "";

  const jobTypesQuery = useJobTypes();
  const jobTagsQuery = useJobTags();
  // The chat pill comes with its unread count, not bare and then wider (the
  // hook asks only a viewer who may read team chat).
  const chatCounters = useTeamChatCounters();
  const { data: companies } = useBusinessProfiles();
  const { data: serviceAreas, isLoading: areasLoading } = useServiceAreas();

  const [state, setState] = useState<JobsListState>(EMPTY_JOBS_LIST_STATE);
  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);
  const [openId, setOpenId] = useState<string | null>(null);
  const visibleFields = useJobFieldsStore((s) => s.visible);
  const fieldOrder = useJobFieldsStore((s) => s.order);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);

  // What the server is asked for: the controls, the search as it stood 300ms
  // after the last key, and — always — the viewer as the tech.
  const listState = useMemo(() => myJobsListState({ ...state, search }, meId), [state, search, meId]);
  const [pageSize, setPageSize] = usePageSize("jobs", { sizes: JOBS_PAGE_SIZES });
  const listParams = useMemo(() => toListParams(listState, pageSize, caps), [listState, pageSize]);
  const countsParams = useMemo(() => toCountsParams(listState, caps), [listState]);
  const searchCountsParams = useMemo(() => toSearchCountsParams(listState, caps), [listState]);

  // Nothing goes out before the viewer is known: without the id it would be
  // somebody else's list.
  const known = Boolean(meId);
  const dealsQuery = useDealsPage(listParams, known);
  const countsQuery = useDealCounts(countsParams, known);
  const searching = searchCountsParams !== null;
  const searchedQuery = useDealCounts(searchCountsParams ?? countsParams, known && searching);
  const counts = withSearchedTab(countsQuery.data, searching ? searchedQuery.data : undefined, state.tab);

  // While the live stream is down, the list asks again every 30s — as the
  // dispatch board does — so a job assigned meanwhile turns up by itself.
  const live = useDealsStreamStore((s) => s.connected);
  const { refetch: refetchRows } = dealsQuery;
  const { refetch: refetchCounts } = countsQuery;
  useEffect(() => {
    if (live || !known) return;
    const timer = setInterval(() => {
      void refetchRows();
      void refetchCounts();
    }, DEALS_POLL_MS);
    return () => clearInterval(timer);
  }, [live, known, refetchRows, refetchCounts]);

  const tabTotal = counts?.[state.tab];
  const pager = usePager(pagedSource(dealsQuery), {
    total: tabTotal === undefined ? undefined : tabTotal,
    totalIsFloor: state.tab !== "unscheduled" && counts?.atLeast?.includes(state.tab),
    pageSize,
    resetKey: JSON.stringify(listParams),
  });

  // The names the rows refer to travel with them: the technicians on the
  // page and the clients, names only.
  const names = useMemo(() => mergeIncluded(dealsQuery.data?.pages), [dealsQuery.data]);
  const contactIds = useMemo(() => pager.items.map((d) => d.contactId), [pager.items]);
  const needsContacts = Boolean(visibleFields.client || visibleFields.phone || visibleFields.email);
  const { map: contactMap, isLoading: contactsLoading } = useContactsByIds(contactIds, needsContacts);

  // The opt-in Dispatcher column names somebody the rows do not carry.
  const dispatcherIds = useMemo(
    () => (visibleFields.dispatcher ? pager.items.map((d) => d.assignedDispatcherId) : []),
    [visibleFields.dispatcher, pager.items],
  );
  const { map: directory, isLoading: directoryLoading } = useUserMap(dispatcherIds);
  const tableNames = useMemo(() => {
    const m = new Map<string, DirectoryUser>(directory);
    for (const [id, person] of names.technicians) m.set(id, person);
    return m;
  }, [directory, names]);

  const catalogs: FilterCatalogs = useMemo(
    () =>
      myJobsCatalogs({
        techs: [],
        tags: activeJobTags(jobTagsQuery.data).map((t) => ({ id: t.id, name: t.name, color: t.color })),
        jobTypes: activeJobTypes(jobTypesQuery.data).map((t) => ({ id: t.id, name: t.name })),
        areas: filterAreas(serviceAreas).map((a) => ({ name: a.name, color: a.color })),
        companies: (companies ?? []).map((c) => ({ id: c.id, name: c.active ? c.name : `${c.name} (archived)` })),
      }),
    [jobTagsQuery.data, jobTypesQuery.data, serviceAreas, companies],
  );

  const areaZone = useMemo(() => new Map((serviceAreas ?? []).map((a) => [a.id, a.timezone])), [serviceAreas]);
  const zoneOf = (d: Deal) => d.jobTimezone || (d.serviceAreaId ? areaZone.get(d.serviceAreaId) : undefined);

  // A pull at the top of the list, on a phone, asks again.
  const { pull, refreshing } = usePullToRefresh(scrollerRef, () => Promise.all([refetchRows(), refetchCounts()]));

  // The scroller's width — where "No Jobs Found" centres.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One frame for everything the list prints, latched per list and page —
  // the `/deals` rule: a new tab or filter starts behind the skeleton, a
  // new search or page keeps the last whole frame until the next is in.
  const paintKey = `${JSON.stringify(listParams)}|${pager.page}`;
  const [painted, setPainted] = useState<string | null>(null);
  const rowsIn = known && !dealsQuery.isLoading;
  const countsIn = countsQuery.data !== undefined || countsQuery.isError;
  const searchedIn = !searching || (searchedQuery.data !== undefined && !searchedQuery.isPlaceholderData) || searchedQuery.isError;
  const jobTypesIn = jobTypesQuery.data !== undefined || jobTypesQuery.isError;
  const contactsIn = !(needsContacts && contactsLoading);
  const namesIn = !(visibleFields.dispatcher && directoryLoading);
  const chatIn = settled(chatCounters);
  const baseKey = JSON.stringify(toListParams({ ...listState, search: "" }, pageSize, caps));
  const [shown, setShown] = useState<Frame | null>(null);
  if (painted !== paintKey && rowsIn && countsIn && searchedIn && jobTypesIn && contactsIn && namesIn && chatIn && !areasLoading) {
    setPainted(paintKey);
    setShown({ base: baseKey, rows: pager.items, contacts: contactMap, clientNames: names.clients, pager, counts });
  }
  const firstPaintPending = painted !== paintKey;
  const held = firstPaintPending && shown?.base === baseKey ? shown : null;
  const tabsShown = painted !== null;
  const tabCounts = held ? held.counts : counts;

  if (denied("deals", "view")) return <NoAccess entity="jobs" />;

  const busy = refreshing || (dealsQuery.isRefetching && !dealsQuery.isFetchingNextPage);
  const tableProps = {
    userMap: tableNames,
    namesLoading: directoryLoading,
    onOpen: (d: Deal) => setOpenId(d.id),
    onRowClick: (d: Deal) => router.push(myJobHref(d.id)),
    visibleFields,
    order: fieldOrder,
    sort: state.sort,
    onSortScheduled: () => setState((s) => ({ ...s, sort: s.sort === "day_desc" ? "none" : "day_desc" })),
    zoneOf,
    accountZone: DEFAULT_TZ,
    viewWidth,
  } as const;

  return (
    // The page scrolls itself, as Workiz's main container does — the grid's
    // header sticks while rows go under it, and a wide grid scrolls sideways
    // under controls that hold still (`sticky left-0`).
    <div
      ref={scrollerRef}
      className="flex min-h-0 flex-1 flex-col overflow-auto text-[#404040]"
      data-slot="jobs-scroller"
      data-testid="my-jobs-scroll"
    >
      {/* Ours: a pull at the top refreshes the list on a phone. */}
      <div
        role="status"
        aria-hidden={!busy && pull === 0}
        className="sticky left-0 flex shrink-0 items-center justify-center overflow-hidden text-[13px] text-wz-slate transition-[height] duration-100"
        style={{ height: busy ? 32 : pull }}
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Refreshing…
          </span>
        ) : pull > 0 ? (
          pull >= PULL_THRESHOLD_PX ? "Release to refresh" : "Pull to refresh"
        ) : null}
      </div>

      {/* Ours: "Keep BitCRM on your phone", only where installing is possible. */}
      <div className="sticky left-0 px-5 empty:hidden">
        <InstallHint />
      </div>

      {/* Filter results + Create New: list_01 — the control 20px in, the yellow pill 16px to its right. */}
      {/* On a phone the control takes its own line and the pills wrap under it. */}
      <div className="sticky left-0 flex flex-wrap items-start gap-4 px-5 pt-[34px]">
        <div className="flex min-w-full flex-1 sm:min-w-0">
          <JobsFilterControl state={state} onChange={setState} catalogs={catalogs} caps={caps} />
        </div>
        {/* Ours, beside Workiz's one button: drawn with the page, count and all. */}
        {tabsShown ? <TeamChatBadge className="h-8" /> : null}
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

      {/* The five status tabs with their numbers; grey placeholders hold the
          strip until the numbers are in, and go in the frame they come. */}
      <div className="relative sticky left-0 mt-[27px] shrink-0">
        {!tabsShown ? (
          <div aria-hidden data-slot="tabs-placeholder" className="absolute inset-0 flex items-center border-b border-wz-tab-rule">
            {TAB_PLACEHOLDER_WIDTHS.map((w, i) => (
              <Skeleton key={i} className="mx-5 h-4" style={{ width: w }} />
            ))}
          </div>
        ) : null}
        <div className={cn(!tabsShown && "invisible")}>
          {/* list_01: the strip 43px from y202, its tabs 4px down and 39px
              tall over the rule — so the strip under it starts at y245. */}
          <WzTabBar
            aria-label="Job status"
            className="pt-1 [&>button]:pb-2"
            tabs={WORKIZ_TABS.map((t) => ({
              value: t,
              label: jobTabLabel(t),
              count: tabCounts ? tabCount(tabCounts, t) : " ",
            }))}
            value={state.tab}
            onValueChange={(t) => setState((s) => ({ ...s, tab: t as JobTab }))}
          />
        </div>
      </div>

      {/* The grey strip: Search, Show unpaid jobs; the page size and Fields at the right. */}
      <WzListToolbar className="sticky left-0 shrink-0 border-[#dddddd]">
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
          <WzPageSizeSelect value={pageSize} onChange={setPageSize} sizes={JOBS_PAGE_SIZES} />
          <FieldsMenu />
        </div>
      </WzListToolbar>

      {/* The grid runs edge to edge, as Workiz's does. */}
      <div className="flex-1">
        {held ? (
          <div aria-busy>
            <DealsTable deals={held.rows} contactMap={held.contacts} clientNames={held.clientNames} {...tableProps} />
            <MyJobsPager pager={held.pager} />
          </div>
        ) : firstPaintPending ? (
          <DealsTableSkeleton visibleFields={visibleFields} order={fieldOrder} />
        ) : dealsQuery.isError ? (
          <ListError onRetry={() => void refetchRows()} retrying={dealsQuery.isFetching} />
        ) : (
          <>
            <DealsTable deals={pager.items} contactMap={contactMap} clientNames={names.clients} {...tableProps} />
            <MyJobsPager pager={pager} />
          </>
        )}
      </div>

      <DealQuickView dealId={openId} open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}

/** Workiz's pager (list_07_bottom); "›" rests on the last counted page, as on `/deals`. */
function MyJobsPager({ pager }: { pager: Pager<Deal> }) {
  return <WzPager className="sticky left-0" pager={{ ...pager, canNext: wzPagerCanNext(pager) }} />;
}

/** The jobs list's own failure block, in its words. */
function ListError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border-y border-[#dddddd] py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="font-medium">Couldn&apos;t load your jobs</div>
      <p className="max-w-xs text-sm text-wz-outline-label">Check your connection and try again.</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
