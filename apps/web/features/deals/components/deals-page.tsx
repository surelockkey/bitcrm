"use client";

import { useMemo, useState } from "react";
import { Briefcase, Search, TriangleAlert } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { EmptyState, NoAccess } from "@/features/clients/components/contacts-page";
import { useDealCounts, useDealsPage, useUserMap } from "../hooks";
import { useContactsByIds } from "@/features/clients/hooks";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { toCountsParams, toListParams, type JobsListState, type JobsSort } from "../query-params";
import { filterDeals, jobTabLabel, JOB_TABS, type JobTab, sortJobs } from "../lib";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { activeJobTypes } from "@/features/job-types/lib";
import { useJobTags } from "@/features/job-tags/hooks";
import { activeJobTags } from "@/features/job-tags/lib";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import { toLocalParts, type DateTimeRange } from "@/lib/date-range";
import { useJobFieldsStore } from "../fields-store";
import { DealsTable } from "./deals-table";
import { DealQuickView } from "./deal-quick-view";
import { FieldsMenu } from "./fields-menu";

const ALL = "all";

export function DealsPage() {
  const { can, isTechnician } = usePermissions();
  const jobTypesQuery = useJobTypes();
  const jobTagsQuery = useJobTags();
  const customFieldsQuery = useCustomFields();

  const [tab, setTab] = useState<JobTab>(JOB_TABS[0]);
  const [search, setSearch] = useState("");
  const [techId, setTechId] = useState(ALL);
  const [jobTypeId, setJobTypeId] = useState(ALL);
  const [serviceArea, setServiceArea] = useState(ALL);
  const [tagId, setTagId] = useState(ALL);
  const [companyId, setCompanyId] = useState(ALL);
  const { data: companies } = useBusinessProfiles();
  const [sortSel, setSortSel] = useState<JobsSort>("none");
  // Range filters: one calendar range for the days, plus a time-of-day window.
  const [dayRange, setDayRange] = useState<DateTimeRange>({});
  const [hourFrom, setHourFrom] = useState("");
  const [hourTo, setHourTo] = useState("");
  const dateFrom = toLocalParts(dayRange.from)?.date ?? "";
  const dateTo = toLocalParts(dayRange.to)?.date ?? "";
  const [openId, setOpenId] = useState<string | null>(null);
  const visibleFields = useJobFieldsStore((s) => s.visible);

  // The toolbar, as the server is asked for it: the tab picks the status (or
  // the undated jobs), the rest are filters, the sort is the visit order.
  const listState: JobsListState = useMemo(
    () => ({
      tab,
      search,
      techId: techId === ALL ? undefined : techId,
      jobTypeId: jobTypeId === ALL ? undefined : jobTypeId,
      serviceArea: serviceArea === ALL ? undefined : serviceArea,
      tagId: tagId === ALL ? undefined : tagId,
      businessProfileId: companyId === ALL ? undefined : companyId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      hourFrom: hourFrom || undefined,
      hourTo: hourTo || undefined,
      sort: sortSel,
    }),
    [tab, search, techId, jobTypeId, serviceArea, tagId, companyId, dateFrom, dateTo, hourFrom, hourTo, sortSel],
  );
  const listParams = useMemo(() => toListParams(listState), [listState]);
  const countsParams = useMemo(() => toCountsParams(listState), [listState]);

  const dealsQuery = useDealsPage(listParams);
  const countsQuery = useDealCounts(countsParams);
  const deals = useMemo(() => dealsQuery.data?.pages.flatMap((p) => p.data) ?? [], [dealsQuery.data]);

  // Only the clients and technicians of the rows on screen are resolved.
  const contactIds = useMemo(() => deals.map((d) => d.contactId), [deals]);
  const { map: contactMap } = useContactsByIds(contactIds);
  const techIdsOnDeals = useMemo(() => {
    const ids = new Set<string>();
    for (const d of deals) d.assignedTechIds.forEach((t) => ids.add(t));
    return [...ids];
  }, [deals]);
  // The tech filter lists the roster, not whoever happens to be on this page.
  const { profiles: technicians } = useAllTechnicians();
  const { map: userMap } = useUserMap([...techIdsOnDeals, ...technicians.map((t) => t.userId)]);
  const techOptions = useMemo(
    () =>
      technicians
        .map(({ userId }) => {
          const u = userMap.get(userId);
          return { value: userId, label: u ? `${u.firstName} ${u.lastName}`.trim() : userId };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [technicians, userMap],
  );

  // The area filter is the catalog, as Workiz offers it.
  const { data: serviceAreas } = useServiceAreas();
  const areaOptions = useMemo(
    () => (serviceAreas ?? []).filter((a) => a.active).map((a) => ({ value: a.name, label: a.name })),
    [serviceAreas],
  );

  // Searchable custom-field definitions let free-text search match their answers.
  const searchableFields = useMemo(
    () => (customFieldsQuery.data ?? []).filter((f) => f.searchable),
    [customFieldsQuery.data],
  );

  // A job code went to the server; any other text narrows the rows on screen
  // (name, area, custom answers) until the search service takes it over.
  const visible = useMemo(() => {
    const q = search.trim();
    const rows = q && !listParams.search ? filterDeals(deals, { search: q }, contactMap, searchableFields) : deals;
    // The server already orders by day; the hour sorts are settled here.
    if (sortSel === "hour_asc" || sortSel === "hour_desc") {
      return sortJobs(rows, { key: "hour", dir: sortSel === "hour_asc" ? "asc" : "desc" });
    }
    return rows;
  }, [deals, search, listParams.search, contactMap, searchableFields, sortSel]);

  const counts = countsQuery.data;

  if (!can("deals", "view")) return <NoAccess entity="deals" />;

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{isTechnician ? "My Jobs" : "Jobs"}</h1>
          <p className="text-sm text-muted-foreground">
            {isTechnician ? "Your assigned jobs." : "The job pipeline, grouped by status."}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Search job #, client, area…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect value={techId} onChange={setTechId} allLabel="All techs" options={techOptions} width={150} />
        <FilterSelect value={jobTypeId} onChange={setJobTypeId} allLabel="All job types" options={activeJobTypes(jobTypesQuery.data).map((t) => ({ value: t.id, label: t.name }))} width={160} />
        <FilterSelect value={serviceArea} onChange={setServiceArea} allLabel="All areas" options={areaOptions} width={150} />
        <FilterSelect value={tagId} onChange={setTagId} allLabel="Any tag" options={activeJobTags(jobTagsQuery.data).map((t) => ({ value: t.id, label: t.name }))} width={130} />
        {/* Only worth a control once there's more than one company. */}
        {(companies?.length ?? 0) > 1 ? (
          <FilterSelect value={companyId} onChange={setCompanyId} allLabel="All companies" ariaLabel="Company filter" options={(companies ?? []).map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (archived)` }))} width={150} />
        ) : null}
        <select
          aria-label="Sort jobs"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={sortSel}
          onChange={(e) => setSortSel(e.target.value as JobsSort)}
        >
          <option value="none">Sort: Soonest first</option>
          <option value="day_asc">Day &#8593;</option>
          <option value="day_desc">Day &#8595;</option>
          <option value="hour_asc">Hour &#8593;</option>
          <option value="hour_desc">Hour &#8595;</option>
        </select>
        {/* Only forward-looking one-click ranges: an open board carries no
            past-day jobs — anything overdue stays visible with its marker
            until it's closed or canceled. */}
        <DateTimeRangePicker dateOnly label="Days" value={dayRange} onChange={setDayRange} presets={["today"]} />
        <Input type="time" aria-label="From hour" className="h-9 w-28" value={hourFrom} onChange={(e) => setHourFrom(e.target.value)} />
        <Input type="time" aria-label="To hour" className="h-9 w-28" value={hourTo} onChange={(e) => setHourTo(e.target.value)} />
        <div className="ml-auto">
          <FieldsMenu />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 overflow-x-auto border-b px-6" role="tablist" aria-label="Job status">
        {JOB_TABS.map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {jobTabLabel(t)}
              <span
                className={cn(
                  "rounded-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  active ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground",
                )}
              >
                {counts?.[t] ?? (counts ? "—" : "…")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {dealsQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : dealsQuery.isError ? (
          <DealsError onRetry={() => dealsQuery.refetch()} isRetrying={dealsQuery.isFetching} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="size-6" />}
            title={deals.length ? "No matching jobs" : isTechnician ? "No jobs assigned yet" : "No jobs yet"}
            hint={
              deals.length
                ? "Try another tab, search, or filter."
                : isTechnician
                  ? "Assigned jobs will appear here."
                  : "Create your first job to get started."
            }
          />
        ) : (
          <>
            <DealsTable deals={visible} contactMap={contactMap} userMap={userMap} onOpen={(d: Deal) => setOpenId(d.id)} visibleFields={visibleFields} />
            {dealsQuery.hasNextPage ? (
              <div className="flex items-center justify-center gap-3 py-4">
                <span className="text-xs text-muted-foreground">Showing {deals.length}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void dealsQuery.fetchNextPage()}
                  disabled={dealsQuery.isFetchingNextPage}
                >
                  {dealsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <DealQuickView dealId={openId} open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}

function DealsError({ onRetry, isRetrying }: { onRetry: () => void; isRetrying: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="font-medium">Couldn&apos;t load jobs</div>
      <p className="max-w-xs text-sm text-muted-foreground">
        Something went wrong fetching the pipeline. Check your connection and try again.
      </p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  width,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
  width: number;
  ariaLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9" style={{ width }} aria-label={ariaLabel}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
