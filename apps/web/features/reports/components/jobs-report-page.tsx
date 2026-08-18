"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { SUPER_STATUS_ORDER } from "@bitcrm/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useCompanyMap } from "@/features/clients/hooks";
import { contactName, formatPhone, primaryEmail, primaryPhone } from "@/features/clients/lib";
import { useContactMap, useDeals, useUserMap } from "@/features/deals/hooks";
import { formatSchedule, superStatusLabel } from "@/features/deals/lib";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { activeJobTypes, useJobTypeName } from "@/features/job-types/lib";
import { useJobSources } from "@/features/job-sources/hooks";
import { activeJobSources, useJobSourceName } from "@/features/job-sources/lib";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { activeJobStatuses, useJobStatusName } from "@/features/job-statuses/lib";
import { useJobTags } from "@/features/job-tags/hooks";
import { activeJobTags } from "@/features/job-tags/lib";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { sortJobs, type JobSort } from "@/features/deals/lib";
import {
  datePresetRange,
  filterJobsReport,
  jobsReportCsv,
  paginate,
  type DatePreset,
  type JobsReportDateField,
} from "../lib";

const ALL = "__all";
const PAGE_SIZES = [10, 25, 50, 100];

const money = (n?: number) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");

function when(ts?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Compact filter dropdown (mirrors the Jobs-page toolbar selects). */
function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  width = 150,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
  width?: number;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9" style={{ width }} aria-label={allLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Pager({
  page,
  pages,
  total,
  from,
  to,
  onPage,
  size,
  onSize,
  right,
}: {
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
  onPage: (p: number) => void;
  size?: number;
  onSize?: (s: number) => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {size !== undefined && onSize ? (
        <select
          aria-label="Rows per page"
          className="h-8 rounded-md border bg-transparent px-2 text-sm"
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : null}
      <span className="text-xs tabular-nums text-muted-foreground">
        {total === 0 ? "0 of 0" : `${from}–${to} of ${total}`}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        aria-label="Next page"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight className="size-4" />
      </Button>
      <span className="flex-1" />
      {right}
    </div>
  );
}

/**
 * The Workiz Jobs report in our UI: the full jobs list with report filters
 * (status/sub-status, team, creator, tags, type, source, area, company), a
 * date range driven by a chosen date field, top+bottom pagination and CSV
 * export. Everything is computed client-side over the loaded jobs.
 */
export function JobsReportPage() {
  const { can } = usePermissions();
  const { data: dealsData, isLoading } = useDeals();
  const deals = useMemo(() => dealsData ?? [], [dealsData]);
  const { map: contactMap } = useContactMap();
  const { map: userMap } = useUserMap();
  const { map: companyMap } = useCompanyMap();
  const { data: customFieldDefs } = useCustomFields();
  const jobTypesQuery = useJobTypes();
  const jobSourcesQuery = useJobSources();
  const jobStatusesQuery = useJobStatuses();
  const jobTagsQuery = useJobTags();
  const jobTypeName = useJobTypeName();
  const sourceName = useJobSourceName();
  const subStatusName = useJobStatusName();

  const [search, setSearch] = useState("");
  const [superStatus, setSuperStatus] = useState(ALL);
  const [subStatusId, setSubStatusId] = useState(ALL);
  const [techId, setTechId] = useState(ALL);
  const [createdBy, setCreatedBy] = useState(ALL);
  const [tagId, setTagId] = useState(ALL);
  const [jobTypeId, setJobTypeId] = useState(ALL);
  const [sourceId, setSourceId] = useState(ALL);
  const [serviceArea, setServiceArea] = useState(ALL);
  const [companyId, setCompanyId] = useState(ALL);

  const todayIso = new Date().toISOString().slice(0, 10);
  const [dateField, setDateField] = useState<JobsReportDateField>("createdAt");
  // "All time" by default — a fresh report should show everything;
  // the Workiz-style weekly window is one click away in the presets.
  const [preset, setPreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = preset === "custom"
    ? { from: customFrom || undefined, to: customTo || undefined }
    : datePresetRange(preset, todayIso);

  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [sortSel, setSortSel] = useState("none");

  const contactNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, c] of contactMap) m.set(id, contactName(c));
    return m;
  }, [contactMap]);

  const searchableFields = useMemo(
    () => (customFieldDefs ?? []).filter((f) => f.searchable),
    [customFieldDefs],
  );

  const filtered = useMemo(
    () =>
      filterJobsReport(
        deals,
        {
          search: search || undefined,
          superStatus: superStatus === ALL ? undefined : (superStatus as Deal["superStatus"]),
          subStatusId: subStatusId === ALL ? undefined : subStatusId,
          techId: techId === ALL ? undefined : techId,
          createdBy: createdBy === ALL ? undefined : createdBy,
          tagId: tagId === ALL ? undefined : tagId,
          jobTypeId: jobTypeId === ALL ? undefined : jobTypeId,
          sourceId: sourceId === ALL ? undefined : sourceId,
          serviceArea: serviceArea === ALL ? undefined : serviceArea,
          companyId: companyId === ALL ? undefined : companyId,
          dateField,
          dateFrom: range.from,
          dateTo: range.to,
        },
        contactNames,
        searchableFields,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- range derives from preset/custom values
    [deals, search, superStatus, subStatusId, techId, createdBy, tagId, jobTypeId, sourceId, serviceArea, companyId, dateField, preset, customFrom, customTo, contactNames, searchableFields],
  );

  const sorted = useMemo(() => {
    if (sortSel === "none") return filtered;
    const [key, dir] = sortSel.split("_") as [JobSort["key"], JobSort["dir"]];
    return sortJobs(filtered, { key, dir }, dateField);
  }, [filtered, sortSel, dateField]);

  const p = paginate(sorted, page, size);
  const from = p.total === 0 ? 0 : (p.page - 1) * size + 1;
  const to = Math.min(p.page * size, p.total);

  if (!can("reports", "view")) return <NoAccess entity="reports" />;

  const personName = (id?: string) => {
    const u = id ? userMap.get(id) : undefined;
    return u ? `${u.firstName} ${u.lastName}`.trim() : "—";
  };

  const areas = [...new Set(deals.map((d) => d.serviceArea).filter(Boolean))].sort();
  const users = [...userMap.values()].map((u) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName}`.trim() || u.id,
  }));

  const exportCsv = () => {
    const csv = jobsReportCsv(
      sorted.map((d) => {
        const c = contactMap.get(d.contactId);
        return {
          "Job #": String(d.dealNumber),
          Client: c ? contactName(c) : "",
          Type: jobTypeName(d.jobTypeId),
          Created: d.createdAt,
          Scheduled: d.scheduledDate ?? "",
          Phone: c ? (primaryPhone(c) ?? "") : "",
          Email: c ? (primaryEmail(c) ?? "") : "",
          Status: superStatusLabel(d.superStatus),
          "Sub-status": d.subStatusId ? subStatusName(d.subStatusId) : "",
          Tech: d.assignedTechIds.map((t) => personName(t)).join("; "),
          Address: d.address?.street ?? "",
          City: d.address?.city ?? "",
          State: d.address?.state ?? "",
          "Service area": d.serviceArea,
          Total: money(d.actualTotal ?? d.estimatedTotal),
          Source: sourceName(d.sourceId),
        };
      }),
    );
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `jobs-report-${todayIso}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pager = (withSize: boolean) => (
    <Pager
      page={p.page}
      pages={p.pages}
      total={p.total}
      from={from}
      to={to}
      onPage={setPage}
      size={withSize ? size : undefined}
      onSize={withSize ? (s) => { setSize(s); setPage(1); } : undefined}
      right={
        withSize ? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={exportCsv}>
            <Download className="size-3.5" /> Export
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/reports" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft className="size-4" /> Reports
            </Link>
            <h1 className="text-lg font-semibold tracking-tight">Jobs Report</h1>
          </div>
          <p className="text-sm text-muted-foreground">Every job, filterable and exportable.</p>
        </div>

        {/* Date range — Workiz's "This week (Mon–Today) / By: field" corner. */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Date field"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={dateField}
            onChange={(e) => { setDateField(e.target.value as JobsReportDateField); setPage(1); }}
          >
            <option value="createdAt">By: Job created</option>
            <option value="scheduledDate">By: Job date</option>
          </select>
          <select
            aria-label="Date preset"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => { setPreset(e.target.value as DatePreset); setPage(1); }}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">This week (Mon–Today)</option>
            <option value="last_week">Last week</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="all">All time</option>
            <option value="custom">Custom</option>
          </select>
          <Input
            type="date"
            aria-label="From date"
            className="h-9 w-36"
            value={preset === "custom" ? customFrom : (range.from ?? "")}
            onChange={(e) => { setPreset("custom"); setCustomFrom(e.target.value); setCustomTo(range.to ?? customTo); setPage(1); }}
          />
          <Input
            type="date"
            aria-label="To date"
            className="h-9 w-36"
            value={preset === "custom" ? customTo : (range.to ?? "")}
            onChange={(e) => { setPreset("custom"); setCustomTo(e.target.value); setCustomFrom(range.from ?? customFrom); setPage(1); }}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Search job #, client, area…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <FilterSelect value={superStatus} onChange={(v) => { setSuperStatus(v); setPage(1); }} allLabel="All statuses" options={SUPER_STATUS_ORDER.map((s) => ({ value: s, label: superStatusLabel(s) }))} />
        <FilterSelect value={subStatusId} onChange={(v) => { setSubStatusId(v); setPage(1); }} allLabel="All sub-statuses" width={170} options={activeJobStatuses(jobStatusesQuery.data).map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect value={techId} onChange={(v) => { setTechId(v); setPage(1); }} allLabel="All techs" options={users} />
        <FilterSelect value={createdBy} onChange={(v) => { setCreatedBy(v); setPage(1); }} allLabel="All creators" options={users} />
        <FilterSelect value={tagId} onChange={(v) => { setTagId(v); setPage(1); }} allLabel="All tags" options={activeJobTags(jobTagsQuery.data).map((t) => ({ value: t.id, label: t.name }))} />
        <FilterSelect value={jobTypeId} onChange={(v) => { setJobTypeId(v); setPage(1); }} allLabel="All job types" width={160} options={activeJobTypes(jobTypesQuery.data).map((t) => ({ value: t.id, label: t.name }))} />
        <FilterSelect value={sourceId} onChange={(v) => { setSourceId(v); setPage(1); }} allLabel="All sources" options={activeJobSources(jobSourcesQuery.data).map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect value={serviceArea} onChange={(v) => { setServiceArea(v); setPage(1); }} allLabel="All areas" options={areas.map((a) => ({ value: a, label: a }))} />
        <FilterSelect value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} allLabel="All companies" width={170} options={[...companyMap.values()].map((co) => ({ value: co.id, label: co.title }))} />
        <select
          aria-label="Sort jobs"
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          value={sortSel}
          onChange={(e) => { setSortSel(e.target.value); setPage(1); }}
        >
          <option value="none">Sort: default</option>
          <option value="day_asc">Day &#8593;</option>
          <option value="day_desc">Day &#8595;</option>
          <option value="hour_asc">Hour &#8593;</option>
          <option value="hour_desc">Hour &#8595;</option>
        </select>
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-label="Loading jobs"
          className="min-w-0 space-y-3 p-6"
        >
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
      <div className="min-w-0 space-y-3 p-6">
        {pager(true)}

        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Job #</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tech</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>City</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Service area</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.rows.map((d) => {
                const c = contactMap.get(d.contactId);
                const phone = c ? primaryPhone(c) : undefined;
                return (
                  <TableRow key={d.id} className="align-top">
                    <TableCell className="font-mono text-xs">
                      <Link href={`/deals/${d.id}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {d.dealNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{c ? contactName(c) : "—"}</TableCell>
                    <TableCell>{d.tagIds?.length ? <JobTagChips ids={d.tagIds} max={2} /> : "—"}</TableCell>
                    <TableCell className="text-sm">{jobTypeName(d.jobTypeId)}</TableCell>
                    <TableCell className="text-sm">{when(d.createdAt)}</TableCell>
                    <TableCell className="text-sm">{formatSchedule(d.scheduledDate, d.scheduledTimeSlot)}</TableCell>
                    <TableCell className="text-sm">{phone ? formatPhone(phone) : "—"}</TableCell>
                    <TableCell className="text-sm">{c ? (primaryEmail(c) ?? "—") : "—"}</TableCell>
                    <TableCell className="text-sm">
                      {superStatusLabel(d.superStatus)}
                      {d.subStatusId ? (
                        <div className="text-xs text-muted-foreground">{subStatusName(d.subStatusId)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      {d.assignedTechIds.length ? d.assignedTechIds.map((t) => personName(t)).join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.address?.street ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.address?.city ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.address?.state ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.serviceArea || "—"}</TableCell>
                    <TableCell className="text-sm tabular-nums">{money(d.actualTotal ?? d.estimatedTotal)}</TableCell>
                    <TableCell className="text-sm">{sourceName(d.sourceId)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {p.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No jobs match the filters.</p>
          ) : null}
        </div>

        {pager(false)}
      </div>
      )}
    </div>
  );
}
