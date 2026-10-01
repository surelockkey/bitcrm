"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import type {
  CommissionReport,
  CommissionReportBy,
  CommissionReportMode,
  CommissionReportRow,
  CommissionReportTotalKey,
} from "@bitcrm/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DAY_END, DAY_START, toIsoInstant, toLocalParts } from "@/lib/date-range";
import { useDenied } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useExternalCompanies } from "@/features/external-companies/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { downloadCommissionCsv, useCommissionReport } from "../commissions/hooks";
import {
  COMMISSION_DATE_PRESETS,
  cellText,
  commissionColumns,
  commissionPresetRange,
  formatMoney,
  loadColumnChoices,
  saveColumnChoices,
  type ColumnChoices,
  visibleColumns,
  type CommissionColumn,
  type CommissionDatePreset,
  type CommissionReportFilters,
} from "../commissions/lib";

const ALL = "";
const PAGE_SIZES = [10, 25, 50, 100];
const MODES: { id: CommissionReportMode; label: string }[] = [
  { id: "standard", label: "Standard Report" },
  { id: "tech", label: "Tech Report" },
  { id: "external", label: "External Company" },
];
const BY: { id: CommissionReportBy; label: string }[] = [
  { id: "created", label: "Created" },
  { id: "scheduled", label: "Scheduled" },
  { id: "closed", label: "Closed" },
];
const BY_TYPE: { label: string; key: CommissionReportTotalKey }[] = [
  { label: "cash", key: "cash" },
  { label: "credit", key: "credit" },
  { label: "billing", key: "billing" },
  { label: "check", key: "check" },
  { label: "cash by external", key: "cashByExternal" },
  { label: "credit by external", key: "creditByExternal" },
  { label: "billing by external", key: "billingByExternal" },
  { label: "check by external", key: "checkByExternal" },
];

const selectClass = "h-9 rounded-md border bg-transparent px-2 text-sm disabled:opacity-50";

/**
 * Workiz "Commissions (Legacy)" — Finance Reporting. Every Done job of a
 * period with what was collected and how, the technician's rate and profit,
 * the company's, and the balance; three modes (Standard, Tech, External
 * Company), Workiz's thirteen date presets, "By Time" Created / Scheduled /
 * Closed (Closed = the end of the visit window), the Fields panel, a Totals
 * row, Total Profits and Total by type, CSV export and print. The office
 * settles technicians weekly (Last week, Mon – Sun) from the Tech Report.
 *
 * Not here (yet): Export By Mail / Send Bulk and Report History — BitCRM has
 * no mail provider — and Settle, which the business never used in Workiz.
 */
export function CommissionsPage({ today }: { today: string }) {
  const denied = useDenied();

  const [mode, setMode] = useState<CommissionReportMode>("standard");
  const [by, setBy] = useState<CommissionReportBy>("closed");
  const [preset, setPreset] = useState<CommissionDatePreset>("today");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [techId, setTechId] = useState(ALL);
  const [jobTypeId, setJobTypeId] = useState(ALL);
  const [serviceAreaId, setServiceAreaId] = useState(ALL);
  const [externalCompanyId, setExternalCompanyId] = useState(ALL);
  const [sourceId, setSourceId] = useState(ALL);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "closedDate", dir: "asc" });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [choices, setChoices] = useState<ColumnChoices>(() => loadColumnChoices());
  const [exporting, setExporting] = useState(false);
  const choice = choices[mode] ?? {};

  // Workiz searches from the third character; a cleared box searches nothing.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      if (next.length === 0 || next.length >= 3) {
        setQ(next);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = preset === "custom" ? custom : commissionPresetRange(preset, today);
  const from = range.from ?? today;
  const to = range.to ?? from;
  // The Tech Report needs a technician: until one is picked, the period's
  // technicians are listed (the Standard report's slice) to pick from.
  const picking = mode === "tech" && !techId;
  const filters: CommissionReportFilters = {
    from,
    to,
    by,
    mode: picking ? "standard" : mode,
    techId: techId || undefined,
    jobTypeId: jobTypeId || undefined,
    serviceAreaId: serviceAreaId || undefined,
    externalCompanyId: externalCompanyId || undefined,
    sourceId: sourceId || undefined,
    q: q || undefined,
    sort: sort.key,
    dir: sort.dir,
    offset: (page - 1) * size,
    limit: size,
  };
  const report = useCommissionReport(denied("commission", "view") ? null : filters);

  const jobTypes = useJobTypes().data ?? [];
  const areas = useServiceAreas().data ?? [];
  const companies = useExternalCompanies().data ?? [];
  const sources = useJobSources().data ?? [];

  if (denied("commission", "view")) return <NoAccess entity="the commissions report" />;

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const columns = visibleColumns(mode, choice);
  const toggleColumn = (c: CommissionColumn) => {
    const next = { ...choices, [mode]: { ...choice, [c.id]: !(choice[c.id] ?? c.default) } };
    setChoices(next);
    saveColumnChoices(next);
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCommissionCsv(filters);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const data = report.data;
  const techOptions = data?.techs ?? [];
  const companyJobs = new Map((data?.externalCompanies ?? []).map((c) => [c.externalCompanyId, c.jobs]));

  return (
    <div className="flex flex-1 flex-col overflow-y-auto print:overflow-visible">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4 print:hidden">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Commissions</h1>
          <p className="text-xs text-muted-foreground">Finance Reporting — Done jobs, by technician</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Report mode"
            className={selectClass}
            value={mode}
            onChange={(e) => reset(setMode)(e.target.value as CommissionReportMode)}
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div role="radiogroup" aria-label="By time" className="flex items-center rounded-md border p-0.5 text-sm">
            <span className="px-2 text-xs text-muted-foreground">By Time:</span>
            {BY.map((b) => (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={by === b.id}
                onClick={() => reset(setBy)(b.id)}
                className={`rounded px-2.5 py-1 ${by === b.id ? "bg-accent font-medium" : "text-muted-foreground"}`}
              >
                {b.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Date preset"
            className={selectClass}
            value={preset}
            onChange={(e) => reset(setPreset)(e.target.value as CommissionDatePreset)}
          >
            {COMMISSION_DATE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <DateTimeRangePicker
            dateOnly
            label="Days"
            value={{ from: toIsoInstant(from, DAY_START), to: toIsoInstant(to, DAY_END) }}
            onChange={(r) => {
              setPreset("custom");
              setPage(1);
              setCustom({ from: toLocalParts(r.from)?.date, to: toLocalParts(r.to)?.date });
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3 print:hidden">
        <select aria-label="Job type" className={selectClass} value={jobTypeId} onChange={(e) => reset(setJobTypeId)(e.target.value)}>
          <option value={ALL}>Job Type</option>
          {jobTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label="Technician" className={selectClass} value={techId} onChange={(e) => reset(setTechId)(e.target.value)}>
          <option value={ALL}>{mode === "tech" ? "Select Technician" : "All Technicians"}</option>
          {techId && !techOptions.some((t) => t.techId === techId) && <option value={techId}>{techId}</option>}
          {techOptions.map((t) => (
            <option key={t.techId} value={t.techId}>
              {`${t.techName ?? t.techId}  [${t.jobs}]`}
            </option>
          ))}
        </select>
        <select
          aria-label="Service area"
          className={selectClass}
          value={serviceAreaId}
          onChange={(e) => reset(setServiceAreaId)(e.target.value)}
        >
          <option value={ALL}>All Service Areas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {/* External Company and Ad Group exclude each other, as in Workiz. */}
        <select
          aria-label="External company"
          className={selectClass}
          value={externalCompanyId}
          disabled={Boolean(sourceId)}
          onChange={(e) => reset(setExternalCompanyId)(e.target.value)}
        >
          <option value={ALL}>External Company</option>
          <option value="only">External Only</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {companyJobs.has(c.id) ? `${c.name}  [${companyJobs.get(c.id)}]` : c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Ad group"
          className={selectClass}
          value={sourceId}
          disabled={Boolean(externalCompanyId)}
          onChange={(e) => reset(setSourceId)(e.target.value)}
        >
          <option value={ALL}>Ad Group</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search"
            placeholder="Search"
            className="h-9 w-48 pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="flex-1" />
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void exportCsv()} disabled={exporting || picking}>
          <Download className="size-4" aria-hidden />
          Export
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={picking}>
              <Columns3 className="size-4" aria-hidden />
              Fields
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {commissionColumns(mode).map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={choice[c.id] ?? c.default}
                onCheckedChange={() => toggleColumn(c)}
                onSelect={(e) => e.preventDefault()}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => window.print()} disabled={picking}>
          <Printer className="size-4" aria-hidden />
          Print
        </Button>
      </div>

      {report.error ? (
        <p role="alert" className="p-6 text-sm text-destructive">
          {report.error instanceof Error ? report.error.message : "Could not load the report."}
        </p>
      ) : !data ? (
        <div role="status" aria-label="Loading report" className="space-y-3 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : picking ? (
        <TechPicker report={data} onPick={(id) => reset(setTechId)(id)} />
      ) : (
        <div className="flex flex-col gap-6 p-6">
          <div className="hidden print:block">
            <h1 className="text-lg font-semibold">
              Commissions — {MODES.find((m) => m.id === mode)?.label}
              {mode === "tech" && data.rows[0]?.techName ? ` — ${data.rows[0].techName}` : ""}
            </h1>
            <p className="text-sm">
              {from} to {to}, by {by}
            </p>
          </div>
          {data.warnings.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>Some figures are incomplete</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <ReportTable
            report={data}
            columns={columns}
            sort={sort}
            onSort={(key) => {
              setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
              setPage(1);
            }}
          />
          <Pager
            page={page}
            size={size}
            count={data.count}
            onPage={setPage}
            onSize={(s) => {
              setSize(s);
              setPage(1);
            }}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <TotalProfits report={data} mode={mode} />
            <TotalsByType report={data} />
          </div>
        </div>
      )}
    </div>
  );
}

function ReportTable({
  report,
  columns,
  sort,
  onSort,
}: {
  report: CommissionReport;
  columns: CommissionColumn[];
  sort: { key: string; dir: "asc" | "desc" };
  onSort: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto border print:overflow-visible">
      <Table aria-label="Commissions" contained={false}>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.id} className={c.numeric ? "text-right" : undefined}>
                {c.sort ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium"
                    onClick={() => onSort(c.sort!)}
                    aria-label={`Sort by ${c.label}`}
                  >
                    {c.label}
                    {sort.key === c.sort &&
                      (sort.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                  </button>
                ) : (
                  c.label
                )}
              </TableHead>
            ))}
          </TableRow>
          <TableRow className="bg-muted/40 font-medium">
            {columns.map((c, i) => (
              <TableCell key={c.id} className={c.numeric ? "text-right tabular-nums" : undefined}>
                {i === 0 ? `Totals:${report.count}` : c.total ? formatMoney(report.totals[c.total].amount) : c.id === "externalBalance" ? formatMoney(-report.totals.cashByExternal.amount) : ""}
              </TableCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                No Done jobs in this period.
              </TableCell>
            </TableRow>
          ) : (
            report.rows.map((row) => <ReportRow key={row.dealId} row={row} columns={columns} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ReportRow({ row, columns }: { row: CommissionReportRow; columns: CommissionColumn[] }) {
  return (
    <TableRow>
      {columns.map((c) => (
        <TableCell key={c.id} className={c.numeric ? "text-right tabular-nums" : "whitespace-normal"}>
          {c.id === "dealNumber" ? (
            <Link href={`/deals/${row.dealId}`} className="font-medium text-brand underline-offset-2 hover:underline">
              {row.dealNumber}
            </Link>
          ) : (
            cellText(row, c.id)
          )}
        </TableCell>
      ))}
    </TableRow>
  );
}

function Pager({
  page,
  size,
  count,
  onPage,
  onSize,
}: {
  page: number;
  size: number;
  count: number;
  onPage: (p: number) => void;
  onSize: (s: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / size));
  const first = count === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(count, page * size);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
      <span className="text-muted-foreground">Show</span>
      <select aria-label="Rows per page" className="h-8 rounded-md border bg-transparent px-2" value={size} onChange={(e) => onSize(Number(e.target.value))}>
        {PAGE_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">entries</span>
      <span className="flex-1" />
      <span className="tabular-nums text-muted-foreground">{`Showing ${first} to ${last} of ${count.toLocaleString("en-US")} entries`}</span>
      <Button variant="outline" size="icon" className="size-8" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <Button variant="outline" size="icon" className="size-8" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

function TotalProfits({ report, mode }: { report: CommissionReport; mode: CommissionReportMode }) {
  const rows: { label: string; key: CommissionReportTotalKey }[] =
    mode === "tech"
      ? [{ label: "tech profit", key: "techProfit" }]
      : [
          { label: "external company profit", key: "externalCompanyProfit" },
          { label: "company profit", key: "companyProfit" },
          { label: "tech profit", key: "techProfit" },
        ];
  return (
    <Card className="gap-3 px-4 py-4">
      <h2 className="text-base font-semibold">Total Profits</h2>
      <Table aria-label="Total Profits">
        <TableHeader>
          <TableRow>
            <TableHead>Profit For</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(report.totals[r.key].amount)}</TableCell>
            </TableRow>
          ))}
          {mode === "tech" && (
            <TableRow>
              <TableCell>balance</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(report.totals.balance.amount)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function TotalsByType({ report }: { report: CommissionReport }) {
  return (
    <Card className="gap-3 px-4 py-4">
      <h2 className="text-base font-semibold">Total by type</h2>
      <Table aria-label="Total by type">
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Jobs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {BY_TYPE.map((t) => (
            <TableRow key={t.key}>
              <TableCell>{t.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(report.totals[t.key].amount)}</TableCell>
              <TableCell className="text-right tabular-nums">{report.totals[t.key].jobs}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** The Tech Report before a technician is picked: who worked the period, and where each one stands. */
function TechPicker({ report, onPick }: { report: CommissionReport; onPick: (techId: string) => void }) {
  const techs = report.techs;
  return (
    <div className="flex flex-col gap-3 p-6">
      <p className="text-sm text-muted-foreground">Select a technician to open their report for this period.</p>
      <div className="overflow-x-auto border">
        <Table aria-label="Technicians" contained={false}>
          <TableHeader>
            <TableRow>
              <TableHead>Tech</TableHead>
              <TableHead className="text-right">Jobs</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Tech Profit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {techs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No Done jobs in this period.
                </TableCell>
              </TableRow>
            ) : (
              techs.map((t) => (
                <TableRow key={t.techId}>
                  <TableCell>
                    <button type="button" className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => onPick(t.techId)}>
                      {t.techName ?? t.techId}
                    </button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.jobs}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(t.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(t.techProfit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(t.balance)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
