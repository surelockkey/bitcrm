"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, Plus, Search, TriangleAlert } from "lucide-react";
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
import { contactName } from "@/features/clients/lib";
import { useContactMap, useDeals, useUserMap } from "../hooks";
import {
  filterDeals,
  jobTabLabel,
  matchesTab,
  tabCounts,
  JOB_TABS,
  type DealFilter,
  type JobTab,
} from "../lib";
import { useJobTypes } from "@/features/job-types/hooks";
import { activeJobTypes } from "@/features/job-types/lib";
import { useJobTags } from "@/features/job-tags/hooks";
import { activeJobTags } from "@/features/job-tags/lib";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { useJobFieldsStore } from "../fields-store";
import { DealsTable } from "./deals-table";
import { DealQuickView } from "./deal-quick-view";
import { FieldsMenu } from "./fields-menu";

const ALL = "all";

export function DealsPage() {
  const { can, isTechnician } = usePermissions();
  const dealsQuery = useDeals();
  const { map: contactMap } = useContactMap();
  const { map: userMap } = useUserMap();
  const jobTypesQuery = useJobTypes();
  const jobTagsQuery = useJobTags();
  const customFieldsQuery = useCustomFields();

  const [tab, setTab] = useState<JobTab>(JOB_TABS[0]);
  const [search, setSearch] = useState("");
  const [techId, setTechId] = useState(ALL);
  const [jobTypeId, setJobTypeId] = useState(ALL);
  const [serviceArea, setServiceArea] = useState(ALL);
  const [tagId, setTagId] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const visibleFields = useJobFieldsStore((s) => s.visible);

  const contactNames = useMemo(() => {
    const m = new Map<string, string>();
    contactMap.forEach((c, id) => m.set(id, contactName(c)));
    return m;
  }, [contactMap]);

  const deals = dealsQuery.data ?? [];

  // Techs that actually appear on deals, resolved to names — the tech filter.
  const techOptions = useMemo(() => {
    const ids = new Set<string>();
    deals.forEach((d) => d.assignedTechIds.forEach((t) => ids.add(t)));
    return [...ids]
      .map((id) => {
        const u = userMap.get(id);
        return { value: id, label: u ? `${u.firstName} ${u.lastName}`.trim() : id };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [deals, userMap]);

  // Distinct service areas present on deals — the area filter.
  const areaOptions = useMemo(() => {
    const set = new Set<string>();
    deals.forEach((d) => d.serviceArea && set.add(d.serviceArea));
    return [...set].sort().map((a) => ({ value: a, label: a }));
  }, [deals]);

  // Everything except the status tab — so tab counts reflect the active filters.
  const baseFilter: DealFilter = useMemo(
    () => ({
      search: search || undefined,
      techId: techId === ALL ? undefined : techId,
      jobTypeId: jobTypeId === ALL ? undefined : jobTypeId,
      serviceArea: serviceArea === ALL ? undefined : serviceArea,
      tagId: tagId === ALL ? undefined : tagId,
    }),
    [search, techId, jobTypeId, serviceArea, tagId],
  );

  // Searchable custom-field definitions let free-text search match their answers.
  const searchableFields = useMemo(
    () => (customFieldsQuery.data ?? []).filter((f) => f.searchable),
    [customFieldsQuery.data],
  );

  const base = useMemo(
    () => filterDeals(deals, baseFilter, contactNames, searchableFields),
    [deals, baseFilter, contactNames, searchableFields],
  );
  const counts = useMemo(() => tabCounts(base), [base]);
  const visible = useMemo(() => base.filter((d) => matchesTab(d, tab)), [base, tab]);

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
        {can("deals", "create") ? (
          <Button asChild variant="brand" className="gap-1.5">
            <Link href="/deals/new"><Plus className="size-4" /> New deal</Link>
          </Button>
        ) : null}
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
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  active ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground",
                )}
              >
                {counts[t]}
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
          <DealsTable deals={visible} contactMap={contactMap} userMap={userMap} onOpen={(d: Deal) => setOpenId(d.id)} visibleFields={visibleFields} />
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
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
  width: number;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9" style={{ width }}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
