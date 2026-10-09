"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { WzGroupedFilter } from "@/components/workiz/grouped-filter";
import { WzPager, type WzPagerState } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { WzTotalCard } from "@/components/workiz/total-card";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { useUserMap } from "@/features/deals/hooks";
import { orderTechs } from "@/features/deals/job-filters";
import { personName } from "@/features/deals/person-name";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { viewerToday } from "@/features/reports/jobs/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { exportPaymentReport } from "../api";
import { usePaymentReport } from "../hooks";
import {
  DEFAULT_PAYMENTS_REPORT_PRESET,
  DEFAULT_REPORT_PAGE_SIZE,
  PAYMENTS_REPORT_PRESETS,
  REPORT_PAGE_SIZES,
  customRangeError,
  paymentFilterGroups,
  paymentTotalMoney,
  paymentsRangeText,
  paymentsReportQuery,
  paymentsReportRange,
  type PaymentsReportFilters,
  type PaymentsReportPreset,
} from "../report";
import { PaymentsReportTable, PaymentsReportTableShell, type PaymentsReportContact } from "./payments-report-table";

/**
 * Workiz Reports → Payments (`/root/payments`), drawn as Workiz draws it
 * (rep_payments_wz_*): "Payments report" with its two total cards; the
 * "Filter results" box and the date box; the list strip (Search, page size,
 * Export); the grid; the pager. Every payment on its payment date and every
 * refund as a negative line of its own, amounts with the tip included —
 * the server's projection (`GET /billing/payments/report`) does the counting,
 * pages with a cursor and orders by payment date.
 *
 * Money (the cards, Amount, Tip) needs `financials.view`, like every amount
 * in BitCRM; the lines themselves need `payments.view`.
 */
export function PaymentsReportPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("payments");
  const money = can("financials");

  // Workiz counts its presets from the viewer's own clock (moment()).
  const [today] = useState(() => viewerToday());
  const [range, setRange] = useState<WzDateRange>(() => ({
    preset: DEFAULT_PAYMENTS_REPORT_PRESET,
    ...paymentsReportRange(DEFAULT_PAYMENTS_REPORT_PRESET, today),
  }));
  const [filters, setFilters] = useState<PaymentsReportFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 350);
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [size, setSize] = useState<number>(DEFAULT_REPORT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const customError = range.preset === "custom" ? customRangeError(range.from, range.to) : null;
  const params = useMemo(
    () => paymentsReportQuery({ range, filters, search, dir, limit: size }),
    [range, filters, search, dir, size],
  );
  const q = usePaymentReport(params, canView && !customError, can("contacts", "view"));

  // A new question starts from its first page — reset while rendering, not
  // in an effect, so no frame shows page 3 of a set that has none.
  const paramsKey = JSON.stringify(params);
  const [seenKey, setSeenKey] = useState(paramsKey);
  if (seenKey !== paramsKey) {
    setSeenKey(paramsKey);
    if (page !== 1) setPage(1);
  }

  const pages = q.data?.pages ?? [];
  const current = Math.min(page, Math.max(pages.length, 1));
  const shown = pages[current - 1];
  const rows = useMemo(() => shown?.items ?? [], [shown]);

  // The people of the page on screen, named as Workiz prints them
  // ("(2) TX - Cannon Burt"); the clients' phones come with the page itself.
  const userIds = useMemo(
    () => rows.flatMap((r) => [r.technicianId, r.collectedById]).filter((id): id is string => !!id),
    [rows],
  );
  const userMap = useUserMap(userIds);

  // The cards and the rows come up together, with the names and numbers
  // under them, once the permissions have answered: until then the report is
  // not asked for, and an unasked report is not an empty one.
  const ready = usePageReady(!permsLoading && settled(q) && !userMap.isLoading);

  // The filter's lists: every area (inactive too, as Workiz), and the team in
  // Workiz's order — who joined first; without the grant to list the team,
  // everyone the directory holds, by name.
  const { data: areaData } = useServiceAreas(canView);
  const { profiles } = useAllTechnicians(can("technicians", "view"));
  const groups = useMemo(() => {
    const nameOf = (id: string) => personName(userMap.map.get(id)) ?? id;
    const team = profiles.length
      ? orderTechs(profiles, nameOf)
      : userMap.users.map((u) => ({ id: u.id, name: personName(u) ?? u.id })).sort((a, b) => a.name.localeCompare(b.name));
    return paymentFilterGroups(
      (areaData ?? []).map((a) => ({ id: a.id, name: a.name, color: a.color })),
      team,
    );
  }, [areaData, profiles, userMap.map, userMap.users]);

  // A refusal only once the answer is in — before it, `can` says no to all.
  if (denied("payments")) return <NoAccess what="payments" />;

  const totals = pages[0]?.totals;
  const total = totals?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / size), current);
  // Numbered by what was actually walked, not page × size: a page the server
  // had to cut short (a rare search over years) must not skew the numbers.
  const before = pages.slice(0, current - 1).reduce((n, p) => n + p.items.length, 0);
  const pager: WzPagerState = {
    page: current,
    from: rows.length === 0 ? 0 : before + 1,
    to: before + rows.length,
    total,
    totalPages: pageCount,
    canPrev: current > 1,
    canNext: (current < pages.length || !!q.hasNextPage) && !q.isPlaceholderData,
    isFetching: q.isFetchingNextPage,
    prev: () => setPage(Math.max(1, current - 1)),
    next: async () => {
      if (current < pages.length) {
        setPage(current + 1);
        return;
      }
      if (!q.hasNextPage || q.isFetchingNextPage) return;
      await q.fetchNextPage();
      setPage(current + 1);
    },
  };

  const contactOf = (id: string): PaymentsReportContact | undefined => shown?.clients?.[id];
  const nameOf = (id: string | undefined, fallback?: string) => (id && personName(userMap.map.get(id))) || fallback;

  const runExport = async () => {
    setExporting(true);
    try {
      // The whole range, not a page of it.
      const out = await exportPaymentReport({ ...params, limit: undefined });
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-background text-wz-strong" data-slot="payments-report-scroller">
      {/* The header (rep_payments_wz_01_default): the title 20px in, centred
          on the cards; the cards 14px under the breadcrumbs, 100px after the
          title and 40px apart. */}
      <div className="flex shrink-0 items-center gap-[100px] px-5 pt-3.5">
        <h1 className="text-xl leading-6 font-semibold tracking-[0.4px] whitespace-nowrap text-foreground">Payments report</h1>
        {money ? (
          <div className="flex gap-10">
            {ready ? (
              <>
                <WzTotalCard value={paymentTotalMoney(totals?.amount ?? 0)} caption="Total amount" />
                <WzTotalCard value={paymentTotalMoney(totals?.tips ?? 0)} caption="Total tips" />
              </>
            ) : (
              <>
                <TotalCardSkeleton />
                <TotalCardSkeleton />
              </>
            )}
          </div>
        ) : (
          // Without the cards the header keeps their height, as Workiz's row does.
          <div className="h-[72px]" />
        )}
      </div>

      {/* The filter 40px under the cards, from 20px in to 20px short of the
          date box; the box 20px off the right edge; 30px down to the strip. */}
      <div className="flex shrink-0 items-start gap-5 px-5 pt-10 pb-[30px]">
        <WzGroupedFilter<keyof PaymentsReportFilters>
          className="min-w-0 flex-1"
          placeholder="Filter results"
          groups={groups}
          value={filters}
          onChange={(next) => setFilters(next as PaymentsReportFilters)}
        />
        <div className="shrink-0">
          <WzDateRangePicker
            presets={PAYMENTS_REPORT_PRESETS}
            value={range}
            onChange={setRange}
            rangeOf={(id) => (id === "custom" ? null : paymentsReportRange(id as Exclude<PaymentsReportPreset, "custom">, today))}
            rangeText={(v) => (v.preset === "all_time" ? paymentsRangeText(v) : undefined)}
            calendar={{ today }}
          />
          {customError ? (
            <p role="alert" className="mt-1 max-w-[362px] text-xs leading-4 text-wz-error">
              {customError}
            </p>
          ) : null}
        </div>
      </div>

      <WzListToolbar className="shrink-0">
        <WzSearchBox value={searchInput} onChange={setSearchInput} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={size} sizes={REPORT_PAGE_SIZES} onChange={setSize} />
          <WzToolbarButton onClick={() => void runExport()} disabled={exporting || !!customError || !ready}>
            <FileText strokeWidth={1.5} /> {exporting ? "Exporting…" : "Export"}
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      <div className="shrink-0">
        {!ready ? (
          <PaymentsReportTableShell money={money} />
        ) : q.isError ? (
          <div className="border border-wz-frame px-5 py-10 text-center text-sm">
            <p role="alert">{getApiErrorMessage(q.error, "Couldn't load payments")}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <PaymentsReportTable
            rows={rows}
            money={money}
            dir={dir}
            onSortDate={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
            contactOf={contactOf}
            nameOf={nameOf}
            busy={q.isPlaceholderData || q.isFetchingNextPage}
          />
        )}
      </div>
      {ready && !q.isError ? <WzPager pager={pager} className="shrink-0" /> : null}
    </div>
  );
}

/** A card's place while the report is on its way: the same box, grey bars where the words go. */
function TotalCardSkeleton() {
  return (
    <div aria-hidden className="flex h-[72px] w-[188px] overflow-hidden rounded-[8px] shadow-[0_0_4px_0_rgba(59,75,82,0.05),0_4px_12px_0_rgba(59,75,82,0.1)]">
      <span className="w-1 bg-foreground" />
      <div className="flex flex-col gap-1.5 px-4 pt-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}
