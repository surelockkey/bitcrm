"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS, type Estimate, type EstimateStatus } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { WzKpiCard, WzKpiCardSkeleton } from "@/components/workiz/kpi-card";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { getApiErrorMessage } from "@/lib/api/errors";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { heldPager, useHeldView } from "@/features/billing/use-held-view";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { useUserMap } from "@/features/deals/hooks";
import { NoAccess } from "@/features/billing/components/list-bits";
import { estimateHref } from "@/features/billing/components/client-documents";
import { DEFAULT_REPORT_PAGE_SIZE, REPORT_PAGE_SIZES } from "@/features/payments/report";
import { viewerToday } from "@/features/reports/jobs/lib";
import { exportEstimateReport } from "@/features/reports/billing/api";
import { useEstimateReport, useEstimateReportCount, useEstimateReportSummary } from "@/features/reports/billing/hooks";
import { downloadCsv, type EstimateReportParams } from "@/features/reports/billing/lib";
import {
  DEFAULT_ESTIMATES_RANGE,
  ESTIMATES_LIST_PRESETS,
  estimateCardText,
  estimatesListParams,
  estimatesListRange,
  estimatesRangeText,
  estimatesWindow,
  nextCreatedSort,
  openCustom,
  type CreatedSort,
} from "../estimates-list";
import { EstimatesGrid, EstimatesGridSkeleton } from "./estimates-grid";
import { NewClientEstimateDialog } from "./new-client-estimate-dialog";

/** Workiz asks for its matches a moment after the last key, as the clients list does. */
const SEARCH_DEBOUNCE_MS = 350;

/*
 * The page's frame, measured off uikit_wz_estimates (1600×1000, content from
 * x=200): the cards 34px under the breadcrumbs, 20px in, 31px apart; 28px
 * down to the status select (471×38) and, at the right, the period box (250)
 * and the 115×32 Add New, 25px off the edge; 25px down to the row Workiz
 * keeps for its bulk actions and "Estimates settings"; 28px down to the grey
 * strip, the grid under it edge to edge.
 */
const CARDS = "grid grid-cols-3 items-start gap-[31px] px-5 pt-[34px] xl:grid-cols-6";

/** "All statuses", then the six — the list filter (pg_estimates_wz_03_status_filter_open). */
const STATUS_OPTIONS: { value: EstimateStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...ESTIMATE_STATUSES.map((s) => ({ value: s, label: ESTIMATE_STATUS_LABELS[s] })),
];

/**
 * Workiz's Estimates page (`/root/estimates/`, also its Reports tile), drawn
 * as Workiz draws it (uikit_wz_estimates, pg_estimates_wz_*): no title — six
 * status cards ("N Worth $X" for the created-date window) that ARE the
 * status filter; the status select, the period box and "+ Add New"; the
 * "Estimates settings" link; the grey strip (Search, page size, Export); the
 * grid with the pager inside its frame. All time by default, newest first.
 *
 * Workiz's tick column and its bulk Change status / Send reminder / Delete
 * are left out: there are no bulk actions here. Ours alone: client
 * estimates (no job) are listed too, with a blank Source.
 */
export function EstimatesPage() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("estimates", "view");
  const [range, setRange] = useState<WzDateRange>(DEFAULT_ESTIMATES_RANGE);
  const [status, setStatus] = useState<EstimateStatus | "all">("all");
  const [dir, setDir] = useState<CreatedSort>("desc");
  const [searchText, setSearchText] = useState("");
  const settledSearch = useDebouncedValue(searchText.trim(), SEARCH_DEBOUNCE_MS);
  // Cleared text asks at once: there is nothing to wait for.
  const search = searchText.trim() ? settledSearch : "";
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const today = viewerToday();
  // The days asked for; null while a Custom span is refused.
  const { window: days, error: rangeError } = estimatesWindow(range);

  // `canView` gates the queries — they must not fetch on a maybe. Until the
  // permissions answer, a disabled query is not an empty answer: the cards
  // would read "0 Worth $0.00" and the grid "No Records Found".
  const enabled = canView && days !== null;
  const summary = useEstimateReportSummary({ from: days?.from, to: days?.to }, enabled);
  // Another date window keeps the numbers on the cards until its own are in.
  const cards = useHeldView(summary.data, [summary.data], !permsLoading && settled(summary));

  const params = estimatesListParams({ window: days ?? {}, status, search, dir });
  const list = useEstimateRows(params, enabled, !permsLoading);
  // The cards with their numbers, the rows and the names beside them come up
  // in one frame — the numbers widen the cards and the names the rows, so
  // anything drawn before them moved when they landed.
  const ready = usePageReady(cards.shown && list.shown);

  // The refusal is the other way round: only once the answer is in.
  if (denied("estimates", "view")) return <NoAccess what="estimates" />;

  const runExport = async () => {
    setExporting(true);
    try {
      const out = await exportEstimateReport(params);
      downloadCsv(out.filename, out.csv);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Couldn't export the estimates"));
    } finally {
      setExporting(false);
    }
  };

  // ⌘/Ctrl/middle click: the estimate in a tab of its own, the list kept.
  const open = (e: Estimate, ev: MouseEvent | KeyboardEvent) => {
    const url = estimateHref(e);
    if (ev.metaKey || ev.ctrlKey || ("button" in ev && ev.button === 1)) window.open(url, "_blank", "noopener,noreferrer");
    else router.push(url);
  };

  if (!ready) return <EstimatesSkeleton />;

  const { rows, contacts, users, pager, error } = list.view;
  const author = (e: Estimate): string | undefined => {
    if (e.createdByName) return e.createdByName;
    const u = users.get(e.createdBy);
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || undefined : undefined;
  };

  return (
    // The page scrolls itself inside the shell, as Workiz's main container does.
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="estimates-scroller">
      <div className={CARDS} aria-label="Filter by status" aria-busy={cards.held || undefined}>
        {ESTIMATE_STATUSES.map((s) => {
          const text = estimateCardText(s, cards.view?.[s]);
          return (
            <WzKpiCard
              key={s}
              value={text.value}
              caption={text.caption}
              label={text.label}
              wrapCaption
              selected={status === s}
              selectedTone="orange"
              onSelect={() => setStatus(s)}
            />
          );
        })}
      </div>

      <div className="mt-7 flex items-start gap-4 pr-[25px] pl-5">
        <div className="min-w-0 flex-1">
          <Select value={status} onValueChange={(v) => setStatus(v as EstimateStatus | "all")}>
            <SelectTrigger aria-label="Status" className="h-[38px] w-[471px] max-w-full pl-[11px] text-base leading-4 text-[#333333]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="pr-3 leading-4 [&>span:first-child]:hidden">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Workiz's bulk bar row (y=314): ours keeps only "Estimates settings" there. */}
          <div className="mt-[25px] flex h-[34px] items-center">
            {can("document_templates", "view") ? (
              <Link
                href="/settings/documents?tab=defaults"
                // uikit_wz_estimates: 199×34, 5px 12px, 15px/18px 500 #3589e9 after a 24px gear.
                className="inline-flex items-center gap-1.5 px-3 py-[5px] text-[15px] leading-[18px] font-medium text-brand no-underline"
              >
                <Settings className="size-6" strokeWidth={1.5} aria-hidden />
                Estimates settings
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-[5px]">
          <WzDateRangePicker
            presets={ESTIMATES_LIST_PRESETS}
            value={range}
            onChange={(next) => setRange(openCustom(next, today))}
            rangeOf={(id) => estimatesListRange(id, today)}
            rangeText={estimatesRangeText}
            customError={rangeError}
            calendar={{ today }}
          />
          {/* Workiz: "+ Add New" beside the dates asks for the client, then opens the new estimate. */}
          {can("estimates", "create") ? (
            <Button className="h-8 shrink-0 gap-[3px] border-0 px-3" onClick={() => setAdding(true)}>
              <Plus className="size-5" strokeWidth={2} />
              <span className="px-1">Add New</span>
            </Button>
          ) : null}
        </div>
      </div>
      <NewClientEstimateDialog open={adding} onOpenChange={setAdding} />

      <WzListToolbar className="mt-7">
        <WzSearchBox value={searchText} onChange={setSearchText} maxLength={100} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={list.pageSize} sizes={REPORT_PAGE_SIZES} onChange={list.setPageSize} />
          <WzToolbarButton onClick={() => void runExport()} disabled={exporting || days === null}>
            <FileText strokeWidth={1.5} /> {exporting ? "Exporting…" : "Export"}
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      {error ? (
        <div role="alert" className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p>{getApiErrorMessage(error, "Couldn't load estimates")}</p>
          <Button variant="outline" className="mt-3" onClick={list.retry}>
            Try again
          </Button>
        </div>
      ) : (
        <EstimatesGrid
          rows={rows}
          contacts={contacts}
          author={author}
          sort={dir}
          onSort={() => setDir(nextCreatedSort)}
          onOpen={open}
          editable={can("estimates", "edit")}
          busy={list.held}
          footer={<WzPager pager={list.held ? heldPager(pager) : pager} plainNumbers />}
        />
      )}
    </div>
  );
}

/** The page before its first frame: the same boxes, empty. */
function EstimatesSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto" aria-busy="true" aria-label="Loading estimates">
      <div className={CARDS}>
        {ESTIMATE_STATUSES.map((s) => (
          <WzKpiCardSkeleton key={s} />
        ))}
      </div>
      <div className="mt-7 flex items-start gap-4 pr-[25px] pl-5">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-[38px] w-[471px] max-w-full" />
          <div className="mt-[25px] h-[34px]" />
        </div>
        <div className="flex shrink-0 items-start gap-[5px]">
          <Skeleton className="h-16 w-[250px]" />
          <Skeleton className="h-8 w-[115px] rounded-pill" />
        </div>
      </div>
      <WzListToolbar className="mt-7">
        <Skeleton className="h-10 w-[348px] max-w-full" />
      </WzListToolbar>
      <EstimatesGridSkeleton />
    </div>
  );
}

/** Rows have no identity of their own while there are none; one empty list keeps the held view still. */
const NO_ROWS: Estimate[] = [];

/**
 * The list as the reader sees it: a page of rows, the clients and authors
 * printed beside them and the pager under them — complete, or the previous
 * complete one while the next is on its way.
 *
 * The clients are a second round trip that cannot start until the rows say
 * whose names to ask for, and authors of estimates made here come from the
 * user directory. Rows drawn before them filled in a beat later (an author's
 * "Added by" line makes the row taller and pushes every row under it).
 */
function useEstimateRows(params: Omit<EstimateReportParams, "cursor" | "limit">, enabled: boolean, permsIn: boolean) {
  const [pageSize, setPageSize] = usePageSize("estimates", { sizes: REPORT_PAGE_SIZES, fallback: DEFAULT_REPORT_PAGE_SIZE });
  const q = useEstimateReport({ ...params, limit: pageSize }, enabled);
  // The count does not depend on the order (an undefined `dir` drops out of the key).
  const count = useEstimateReportCount({ ...params, dir: undefined }, enabled);
  const pager = usePager(pagedSource(q, (page: { items: Estimate[] }) => page.items), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ params, pageSize }),
  });
  const rows: Estimate[] = pager.items.length ? pager.items : NO_ROWS;
  const contacts = useContactsByIds(rows.map((r) => r.contactId));
  const authorIds = rows.filter((r) => !r.createdByName).map((r) => r.createdBy);
  const users = useUserMap(authorIds);
  const complete =
    permsIn &&
    settled(q) &&
    settled(count) &&
    !contacts.isLoading &&
    !(authorIds.length > 0 && users.isLoading);
  const held = useHeldView(
    { rows, contacts: contacts.map, users: users.map, pager, error: q.error },
    [rows, contacts.map, users.map, pager.page, pager.total, q.error],
    complete,
  );
  return { ...held, pageSize, setPageSize, retry: () => void q.refetch() };
}
