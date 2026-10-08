"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Popover } from "radix-ui";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { PaymentReportRow, PaymentReportStatus } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/api/errors";
import { toneClasses } from "@/lib/theme/tone";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess, StatTile } from "@/features/billing/components/list-bits";
import { useUserMap } from "@/features/deals/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { exportPaymentReport } from "../api";
import { usePaymentReport } from "../hooks";
import {
  DEFAULT_PAYMENT_PRESET,
  DEFAULT_REPORT_PAGE_SIZE,
  PAYMENT_DATE_PRESETS,
  REPORT_PAGE_SIZES,
  businessToday,
  customRangeError,
  paymentPresetRange,
  reportDateTime,
  reportFilterGroups,
  reportMoney,
  splitFilters,
  type PaymentDatePreset,
  type ReportFilterKey,
} from "../report";

const STATUS_META: Record<PaymentReportStatus, { label: string; className: string }> = {
  succeeded: { label: "Succeeded", className: toneClasses("success") },
  pending: { label: "Pending", className: toneClasses("warning") },
  failed: { label: "Failed", className: toneClasses("destructive") },
  reversed: { label: "Reversed", className: toneClasses("destructive") },
};

/** Workiz's 14 columns, in Workiz's order. */
const COLUMNS = [
  "ID",
  "Amount",
  "Payment date",
  "Status",
  "Type",
  "Confirmation code",
  "Description",
  "Client",
  "Tip",
  "Card",
  "Technician",
  "Transaction method",
  "Collected by",
  "Job Type",
] as const;

/**
 * Workiz Reports → Payments (`/root/payments`), in our UI: every payment on
 * its payment date and every refund as a negative line of its own; "Total
 * amount" (tips included) and "Total tips" over the whole range; Workiz's
 * date presets, its grouped "Filter results" (Payment type / Service Areas /
 * Technician), search, server paging and the CSV export.
 */
export function PaymentsReportPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("payments");

  const [preset, setPreset] = useState<PaymentDatePreset>(DEFAULT_PAYMENT_PRESET);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selected, setSelected] = useState<ReportFilterKey[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [size, setSize] = useState<number>(DEFAULT_REPORT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const today = businessToday();
  const customError = preset === "custom" ? customRangeError(customFrom, customTo) : null;
  const range = preset === "custom" ? { from: customFrom, to: customTo } : paymentPresetRange(preset, today);

  const params = useMemo(
    () => ({
      ...(range.from && { from: range.from }),
      ...(range.to && { to: range.to }),
      ...splitFilters(selected),
      ...(search && { search }),
      dir,
      limit: size,
    }),
    [range.from, range.to, selected, search, dir, size],
  );
  const q = usePaymentReport(params, canView && !customError);
  // The tiles and the rows come up together, once the permissions have
  // answered: until then the report is not asked for, and an unasked report
  // is not an empty one.
  const ready = usePageReady(!permsLoading && settled(q));

  // A new question starts from its first page — reset while rendering, not
  // in an effect, so no frame shows page 3 of a set that has none.
  const paramsKey = JSON.stringify(params);
  const [seenKey, setSeenKey] = useState(paramsKey);
  if (seenKey !== paramsKey) {
    setSeenKey(paramsKey);
    if (page !== 1) setPage(1);
  }

  const { map: userMap } = useUserMap();
  const { data: areaData } = useServiceAreas(canView);
  const groups = useMemo(
    () =>
      reportFilterGroups(
        (areaData ?? []).filter((a) => a.active !== false).map((a) => ({ id: a.id, name: a.name })),
        [...userMap.values()].map((u) => ({ id: u.id, name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.id })),
      ),
    [areaData, userMap],
  );
  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const o of g.options) m.set(o.key, o.label);
    return m;
  }, [groups]);

  // A refusal only once the answer is in — before it, `can` says no to all.
  if (denied("payments")) return <NoAccess what="payments" />;

  const pages = q.data?.pages ?? [];
  const totals = pages[0]?.totals;
  const total = totals?.count ?? 0;
  const current = Math.min(page, Math.max(pages.length, 1));
  const pageCount = Math.max(1, Math.ceil(total / size), current);
  const rows = pages[current - 1]?.items ?? [];
  // Numbered by what was actually walked, not page × size: a page the server
  // had to cut short (a rare search over years) must not skew the numbers.
  const before = pages.slice(0, current - 1).reduce((n, p) => n + p.items.length, 0);
  const fromRow = rows.length === 0 ? 0 : before + 1;
  const toRow = before + rows.length;
  const canNext = current < pages.length || (!!q.hasNextPage && !q.isFetchingNextPage);

  const goNext = async () => {
    if (current < pages.length) {
      setPage(current + 1);
      return;
    }
    if (!q.hasNextPage || q.isFetchingNextPage) return;
    await q.fetchNextPage();
    setPage(current + 1);
  };

  const toggle = (key: ReportFilterKey) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  const runExport = async () => {
    setExporting(true);
    try {
      // The whole range, not a page of it.
      const query = { ...params, limit: undefined };
      const out = await exportPaymentReport(query);
      if (out.truncated) toast.warning(`Exported the first ${out.count.toLocaleString("en-US")} payments — narrow the range for the rest.`);
      if (typeof URL.createObjectURL !== "function") return;
      const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = out.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Couldn't export the report"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">Payments report</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Date range"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => setPreset(e.target.value as PaymentDatePreset)}
          >
            {PAYMENT_DATE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {preset === "custom" ? (
            <>
              <Input
                type="date"
                aria-label="From"
                className="h-9 w-40"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <Input
                type="date"
                aria-label="To"
                className="h-9 w-40"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </>
          ) : (
            <span className="text-xs tabular-nums text-muted-foreground">
              {range.from && range.to ? `${range.from} – ${range.to}` : "All time"}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        {customError ? (
          <p role="alert" className="text-sm text-destructive">
            {customError}
          </p>
        ) : null}

        {ready ? (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:max-w-xl">
              <StatTile
                label="Total amount"
                loading={q.isLoading}
                value={reportMoney(totals?.amount ?? 0)}
                hint={totals ? `${totals.count.toLocaleString("en-US")} payment${totals.count === 1 ? "" : "s"}` : undefined}
              />
              <StatTile label="Total tips" loading={q.isLoading} value={reportMoney(totals?.tips ?? 0)} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-8"
                  placeholder="Search job #, confirmation, card, amount"
                  aria-label="Search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <FilterResults groups={groups} selected={selected} onToggle={toggle} />
              {selected.map((key) => (
                <Badge key={key} variant="outline" className="gap-1 font-normal">
                  {labelOf.get(key) ?? key.slice(key.indexOf(":") + 1)}
                  <button type="button" aria-label={`Remove ${labelOf.get(key) ?? key}`} onClick={() => toggle(key)}>
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              {selected.length ? (
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected([])}>
                  Clear
                </Button>
              ) : null}
              <span className="flex-1" />
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void runExport()} disabled={exporting || !!customError}>
                <Download className="size-3.5" /> {exporting ? "Exporting…" : "Export"}
              </Button>
            </div>

            {q.isLoading ? (
              <div role="status" aria-label="Loading payments" className="space-y-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : q.isError ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                <p>{getApiErrorMessage(q.error, "Couldn't load payments")}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <div className={cn("overflow-x-auto border", q.isPlaceholderData && "opacity-60")}>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {COLUMNS.map((c) =>
                          c === "Payment date" ? (
                            <TableHead key={c} className="whitespace-nowrap">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 hover:text-foreground"
                                aria-label={`Sort by payment date, ${dir === "desc" ? "oldest" : "newest"} first`}
                                onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
                              >
                                Payment date
                                {dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
                              </button>
                            </TableHead>
                          ) : (
                            <TableHead key={c} className={cn("whitespace-nowrap", (c === "Amount" || c === "Tip") && "text-right")}>
                              {c}
                            </TableHead>
                          ),
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <ReportRow key={`${r.kind}:${r.id}`} row={r} />
                      ))}
                    </TableBody>
                  </Table>
                  {rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
                      <CreditCard className="size-6" />
                      <p className="text-sm">No payments match these filters.</p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    Rows
                    <select
                      aria-label="Rows per page"
                      className="h-8 rounded-md border bg-transparent px-2 text-sm text-foreground"
                      value={size}
                      onChange={(e) => setSize(Number(e.target.value))}
                    >
                      {REPORT_PAGE_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="tabular-nums">
                    Showing {fromRow.toLocaleString("en-US")} to {toRow.toLocaleString("en-US")} of{" "}
                    {total.toLocaleString("en-US")} results
                  </span>
                  <span className="flex-1" />
                  <span className="tabular-nums">
                    Page {current} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Previous page"
                    disabled={current <= 1}
                    onClick={() => setPage(current - 1)}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label="Next page"
                    disabled={!canNext || q.isPlaceholderData}
                    onClick={() => void goNext()}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </>
            )}
          </>
        ) : (
          <PaymentsReportSkeleton />
        )}
      </div>
    </div>
  );
}

/** The report before its first frame: the two tiles, the filters, the rows. */
function PaymentsReportSkeleton() {
  return (
    <div role="status" aria-label="Loading payments" className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:max-w-xl">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

function ReportRow({ row: r }: { row: PaymentReportRow }) {
  const status = r.status ? STATUS_META[r.status] : undefined;
  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-nowrap font-mono text-xs">
        <Link href={`/deals/${r.dealId}`} className="text-wz-link hover:underline">
          {r.dealNumber ?? "Job"}
        </Link>{" "}
        <span className="text-muted-foreground">(Job)</span>
      </TableCell>
      <TableCell className={cn("whitespace-nowrap text-right font-mono tabular-nums", r.amount < 0 && "text-destructive")}>
        {reportMoney(r.amount)}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{reportDateTime(r.at)}</TableCell>
      <TableCell>
        {status ? (
          <Badge variant="outline" className={cn("font-medium", status.className)}>
            {status.label}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-nowrap">{r.typeLabel}</TableCell>
      <TableCell className="max-w-40 truncate">{r.confirmationCode ?? ""}</TableCell>
      <TableCell className="max-w-56 truncate text-muted-foreground" title={r.description}>
        {r.description ?? ""}
      </TableCell>
      <TableCell className="max-w-48 truncate">
        {r.clientName ? (
          <Link href={`/contacts/${r.contactId}`} className="hover:underline">
            {r.clientName}
          </Link>
        ) : (
          ""
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{r.tip ? reportMoney(r.tip) : reportMoney(0)}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">{r.card ?? ""}</TableCell>
      <TableCell className="max-w-40 truncate">
        {r.technicianId && r.technicianName ? (
          <Link href={`/technicians/${r.technicianId}`} className="hover:underline">
            {r.technicianName}
          </Link>
        ) : (
          r.technicianName ?? ""
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">{r.transactionMethod ?? ""}</TableCell>
      <TableCell className="max-w-40 truncate">{r.collectedByName ?? ""}</TableCell>
      <TableCell className="min-w-[250px] truncate">{r.jobTypeName ?? ""}</TableCell>
    </TableRow>
  );
}

/** Workiz's one grouped multi-select: OR inside a group, AND between groups. */
function FilterResults({
  groups,
  selected,
  onToggle,
}: {
  groups: ReturnType<typeof reportFilterGroups>;
  selected: ReportFilterKey[];
  onToggle: (key: ReportFilterKey) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" aria-label="Filter results">
          <ListFilter className="size-3.5" /> Filter results
          {selected.length ? <span className="text-muted-foreground">({selected.length})</span> : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-72 rounded-xl border bg-popover p-0 text-popover-foreground shadow-md"
        >
          <Command loop>
            <CommandInput autoFocus placeholder="Filter results…" className="h-9" />
            <CommandList className="max-h-[min(22rem,var(--radix-popover-content-available-height))]">
              <CommandEmpty>Nothing matches.</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g.heading} heading={g.heading}>
                  {g.options.map((o) => {
                    const on = selected.includes(o.key);
                    return (
                      <CommandItem
                        key={o.key}
                        value={`${g.heading} ${o.label} ${o.key}`}
                        onSelect={() => onToggle(o.key)}
                        aria-selected={on}
                        data-checked={on || undefined}
                      >
                        <span
                          className={cn(
                            "flex size-4 items-center justify-center rounded-sm border",
                            on && "border-primary bg-primary text-primary-foreground",
                          )}
                        >
                          {on ? <Check className="size-3" /> : null}
                        </span>
                        {o.label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
