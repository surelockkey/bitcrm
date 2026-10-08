"use client";

import type { MouseEvent, ReactNode } from "react";
import { Eye } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { JobSuperStatus, type Contact, type Deal, type PersonName } from "@bitcrm/types";
import {
  extensionOf,
  formatAddress,
  formatPhoneWithExtension,
  primaryPhone,
  primaryEmail,
} from "@/features/clients/lib";
import { formatDate } from "@/features/users/lib";
import { useJobTypeName, useJobTypesLoading } from "@/features/job-types/lib";
import { useJobSourceName } from "@/features/job-sources/lib";
import { useExternalCompanyName } from "@/features/external-companies/lib";
import { useJobStatusName } from "@/features/job-statuses/lib";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { DEFAULT_TZ } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  DEFAULT_VISIBLE,
  customFieldIdFromColumn,
  formatCustomFieldValue,
  jobFieldOptions,
  orderedColumns,
  JOB_NUMBER_WIDTH,
  type VisibleFields,
} from "../fields";
import {
  SEND_TO_TECH_CHANNEL_LABEL,
  dealClientName,
  formatStamp,
  isTerminalStatus,
  isUrgent,
} from "../lib";
import { workizFromNow, workizScheduleCell } from "../schedule-cell";
import type { JobsSort } from "../query-params";
import { TechCell } from "./tech-cell";
import { noteToText } from "../note-html";
import { PriorityFlag, StageBadge } from "./deal-badges";
import type { DirectoryUser } from "@/features/deals/hooks";

/**
 * Workiz's jobs grid, measured off list_01_submitted:
 *
 * - header 41px on #f7f7f7, 14px/500 #404040, 10px padding, a solid #ccc
 *   rule right and below; the sorted column carries a 3px dark bar on top
 *   (`inset 0 3px rgba(0,0,0,.6)`; at the bottom when descending);
 * - cells 20px padding all round, top-aligned, 14px/16px #404040, a dotted
 *   #cfcfcf rule between columns, clipped rather than wrapped;
 * - rows zebra (#f7f7f7 on the odd ones), rgba(0,0,0,.05) under the cursor.
 */
const HEAD = "h-[41px] border-b border-r border-input bg-muted px-2.5 text-sm leading-[21px] font-medium text-[#404040]";
const CELL = "overflow-hidden border-r border-dotted border-table-border p-5 align-top text-sm leading-4 text-[#404040]";

/** The job number: Workiz's Job ID column, always first and never hideable. */
const NUMBER_COLUMN = "jobNumber";

/** Starting widths: the registry's own, plus the job number's. */
function columnDefaults(columns: { id: string; width: number }[]): Record<string, number> {
  return Object.fromEntries([
    ...columns.map((c) => [c.id, c.width] as const),
    [NUMBER_COLUMN, JOB_NUMBER_WIDTH] as const,
  ]);
}

/**
 * The table's shell while the jobs are still in flight.
 *
 * Not a grey rectangle: the same header, the same column widths and rows of
 * the same height, so the first painted frame already has the geometry the
 * real rows land into. A `h-64` placeholder followed by a full table is a
 * jump the reader watches happen.
 */
export function DealsTableSkeleton({
  visibleFields = DEFAULT_VISIBLE,
  order = [],
  rows = 12,
}: {
  visibleFields?: VisibleFields;
  order?: readonly string[];
  rows?: number;
}) {
  const { data: customFieldDefs } = useCustomFields();
  const columns = orderedColumns(jobFieldOptions(customFieldDefs), visibleFields, order);
  // The reader's saved widths, so the shell is the geometry the rows land in.
  // No handles here: there is nothing to resize until there is a table.
  const { widthOf } = useColumnWidths("jobs", columnDefaults(columns));

  return (
    <div className="overflow-x-auto border-y border-[#dddddd]" aria-busy role="status" aria-label="Loading jobs">
      <Table className="table-fixed" contained={false} style={{ width: tableWidth(columns, widthOf) }}>
        <colgroup>
          <col style={{ width: widthOf(NUMBER_COLUMN) }} />
          {columns.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(HEAD, "truncate")}>Job ID</TableHead>
            {columns.map((c) => (
              <TableHead key={c.id} className={cn(HEAD, "truncate")}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, i) => (
            <TableRow key={i} className="h-[88px] border-0 hover:bg-transparent">
              <TableCell className={CELL}>
                <Skeleton className="h-4 w-14" />
              </TableCell>
              {columns.map((c) => (
                <TableCell key={c.id} className={CELL}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The grid's own width: every column at its declared width. Wider than the
 * page, it scrolls sideways the way Workiz's does (its Zip code and Total
 * Price columns sit past the right edge); narrower, it stretches to fill.
 */
function tableWidth(columns: { id: string }[], widthOf: (id: string) => number): string {
  const px = widthOf(NUMBER_COLUMN) + columns.reduce((sum, c) => sum + widthOf(c.id), 0);
  return `max(100%, ${px}px)`;
}

/** "RESIDENTIAL" → "Residential", "IN_PROGRESS" → "In progress". */
const pretty = (v?: string) =>
  v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") : "—";

const money = (n?: number) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");

/** No side-loaded names — a stable identity, so it never re-renders the grid. */
const NO_NAMES: Map<string, PersonName> = new Map();

/** A click that should open a new tab rather than move this one. */
const wantsNewTab = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;

export function DealsTable({
  deals,
  contactMap,
  clientNames = NO_NAMES,
  userMap,
  namesLoading = false,
  onOpen,
  onRowClick,
  visibleFields = DEFAULT_VISIBLE,
  order = [],
  sort = "none",
  onSortScheduled,
  zoneOf,
  accountZone = DEFAULT_TZ,
  emptyText = "No Jobs Found",
}: {
  deals: Deal[];
  /**
   * The contacts behind the rows — the only source of a client's number or
   * email. Empty until crm answers: the list then names its clients from
   * `clientNames`.
   */
  contactMap: Map<string, Contact>;
  /**
   * contactId → the client's name, as it came with the rows
   * (`included.clients`). Names and nothing else; a number never travels this
   * way — see `JobsListIncluded`.
   */
  clientNames?: Map<string, PersonName>;
  /**
   * id → person, for the columns that print one: the technicians came with
   * the rows, the rest (dispatcher, created-by) from whatever directory the
   * page already holds.
   */
  userMap: Map<string, DirectoryUser>;
  /**
   * The directory lookup is still in flight. A cell whose id is present but
   * whose name has not landed shows a line rather than "—": the dash is an
   * answer, and replacing it a frame later is the flicker the reader
   * complains about.
   */
  namesLoading?: boolean;
  /** Workiz's "Quick view" chip under the Job ID: the preview drawer. */
  onOpen: (deal: Deal) => void;
  /** A row click: Workiz opens the job itself. */
  onRowClick?: (deal: Deal) => void;
  visibleFields?: VisibleFields;
  /** The column order saved in the Visible fields panel. */
  order?: readonly string[];
  /** Which way the Scheduled column is sorted — the bar on its header. */
  sort?: JobsSort;
  /** Clicking the Scheduled header: Workiz's sortable column. */
  onSortScheduled?: () => void;
  /** The zone a job's visit was booked in, when it is not the account's. */
  zoneOf?: (deal: Deal) => string | undefined;
  /** The account's clock — the first line of every Scheduled cell. */
  accountZone?: string;
  emptyText?: string;
}) {
  const jobTypeName = useJobTypeName();
  const sourceName = useJobSourceName();
  // The catalogs answer on their own schedule. Until they do, `jobTypeName`
  // and friends say "Unknown type" — a statement, and the wrong one, which
  // then rewrites itself under the reader.
  const jobTypesLoading = useJobTypesLoading();
  const externalCompanyName = useExternalCompanyName();
  const subStatusName = useJobStatusName();
  const { data: customFieldDefs } = useCustomFields();

  // Every offerable field (static + active custom), visible ones in saved order.
  const columns = orderedColumns(jobFieldOptions(customFieldDefs), visibleFields, order);
  // The reader's own widths for this table; the registry only sets the start.
  const { widthOf, setWidth, reset } = useColumnWidths("jobs", columnDefaults(columns));
  const now = new Date();

  // A value whose own query has not answered yet. Same height as the text it
  // becomes, so the swap happens in place.
  const pendingLine = <Skeleton className="h-4 w-24" />;

  const personCell = (id?: string): ReactNode => {
    if (!id) return "—";
    const u = userMap.get(id);
    if (u) return `${u.firstName} ${u.lastName}`.trim() || "—";
    return namesLoading ? pendingLine : "—";
  };

  const personName = (id?: string) => {
    const u = id ? userMap.get(id) : undefined;
    return u ? `${u.firstName} ${u.lastName}`.trim() || "—" : "—";
  };

  const cell = (d: Deal, columnId: string): ReactNode => {
    const contact = contactMap.get(d.contactId);
    // Phones come from the CONTACT, never from `deal.phones`, even though the
    // job carries its own copy. crm masks numbers for a caller without
    // `contacts.view_numbers` (masking IS the absence of that grant); deal
    // service masks nothing, so reading the job's copy here would hand every
    // holder of `deals.view` the numbers the grant exists to withhold.
    const phone = contact ? primaryPhone(contact) : undefined;
    const phoneExt = contact && phone ? extensionOf(contact, phone) : "";
    const email = contact ? primaryEmail(contact) : (d.emailAddress ?? undefined);

    switch (columnId) {
      case "client":
        return (
          <>
            <div className="flex items-center gap-2">
              {/* list_01: h5 16px/24px #3b4b52, tracking 0.2px. */}
              <span className="text-base leading-6 tracking-[0.2px] whitespace-nowrap text-[#3b4b52]">
                {dealClientName(d, contact, clientNames.get(d.contactId))}
              </span>
              {isUrgent(d) ? <PriorityFlag /> : null}
            </div>
            {/* One line under the name, never two (635 Workiz cells): the
                company, else the number as a blue tel: link, else the email. */}
            {d.clientCompanyName ? (
              <div className="text-xs leading-[18px] tracking-[0.4px] whitespace-nowrap text-[#3b4b52]">
                {d.clientCompanyName}
              </div>
            ) : phone ? (
              <a
                href={`tel:${phone}`}
                onClick={(e) => e.stopPropagation()}
                className="table text-sm leading-4 whitespace-nowrap text-[#6aa8ee] no-underline hover:underline"
              >
                {formatPhoneWithExtension(phone, phoneExt)}
              </a>
            ) : email ? (
              <div className="text-xs leading-[18px] tracking-[0.4px] whitespace-nowrap text-[#3b4b52]">{email}</div>
            ) : null}
          </>
        );
      case "phone":
        return <span>{phone ? formatPhoneWithExtension(phone, phoneExt) : "—"}</span>;
      case "email":
        return <span>{email ?? "—"}</span>;
      case "clientType":
        return <span>{pretty(d.clientType)}</span>;
      case "tech":
        return <TechCell deal={d} userMap={userMap} />;
      case "dispatcher":
        return <span>{personCell(d.assignedDispatcherId)}</span>;
      case "tags":
        return d.tagIds?.length ? <JobTagChips ids={d.tagIds} solid /> : null;
      case "status":
        return (
          <>
            <StageBadge status={d.superStatus} />
            {d.subStatusId ? (
              <div className="mt-0.5 text-xs text-muted-foreground">{subStatusName(d.subStatusId)}</div>
            ) : null}
          </>
        );
      case "priority":
        return <span>{pretty(d.priority)}</span>;
      // Workiz leaves an unknown place blank, not dashed.
      case "city":
        return <span>{d.address?.city || ""}</span>;
      case "state":
        return <span>{d.address?.state || ""}</span>;
      case "zip":
        return <span>{d.address?.zip || ""}</span>;
      case "address":
        return <span>{d.address ? formatAddress(d.address) : ""}</span>;
      case "serviceArea":
        return <span>{d.serviceArea || ""}</span>;
      case "scheduled":
        return <ScheduledCell deal={d} zone={zoneOf?.(d)} accountZone={accountZone} now={now} />;
      case "end": {
        // Workiz's End: the visit's last day and its closing time, on the account's clock.
        const slotEnd = d.scheduledTimeSlot?.split("-")[1]?.trim();
        const end = workizScheduleCell(
          {
            scheduledDate: d.scheduledEndDate || d.scheduledDate,
            scheduledTimeSlot: slotEnd ? `${slotEnd}-${slotEnd}` : undefined,
            city: d.address?.city,
            zone: zoneOf?.(d),
          },
          accountZone,
          now,
        );
        return <span>{d.scheduledDate ? end.when : ""}</span>;
      }
      case "timeInStatus":
        // Workiz's Time in Status: how long since the job entered its status.
        return <span>{d.statusChangedAt ? workizFromNow(new Date(d.statusChangedAt), now).replace(/ ago$/, "") : ""}</span>;
      case "jobName":
        return <span>{d.jobName ?? ""}</span>;
      case "sent": {
        // Workiz `last_sent`: the click, with the channels it went out on.
        if (!d.sentToTechAt) return <span className="text-muted-foreground">—</span>;
        const via = (d.sentToTechVia ?? [])
          .map((c) => SEND_TO_TECH_CHANNEL_LABEL[c])
          .filter(Boolean)
          .join(" & ");
        return (
          <>
            <div>{formatStamp(d.sentToTechAt)}</div>
            {via ? <div className="mt-1 text-xs text-muted-foreground">{via}</div> : null}
          </>
        );
      }
      case "seen":
        // Workiz `seen`: the first technician to open the job in their app.
        return d.seenByTechAt ? (
          <span className="inline-flex items-center gap-1 text-success-text">
            <Eye className="size-3.5" /> {formatStamp(d.seenByTechAt)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      case "jobType":
        return <span>{d.jobTypeId && jobTypesLoading ? pendingLine : jobTypeName(d.jobTypeId)}</span>;
      case "source":
        return <span>{sourceName(d.sourceId)}</span>;
      case "externalCompany":
        return <span>{externalCompanyName(d.externalCompanyId)}</span>;
      case "company":
        // The name is snapshotted on the job, so no catalog lookup is needed.
        return <span>{d.businessProfileName ?? "—"}</span>;
      case "poNumber":
        return <span>{d.poNumber || "—"}</span>;
      case "total":
        return <span className="tabular-nums">{money(d.totals?.total ?? d.actualTotal ?? d.estimatedTotal)}</span>;
      case "paymentStatus":
        return <span>{d.paymentStatus ? pretty(d.paymentStatus) : "—"}</span>;
      case "notes":
        return <span className="block truncate text-muted-foreground">{noteToText(d.notes) || "—"}</span>;
      case "createdBy":
        return <span>{personName(d.createdBy)}</span>;
      case "createdAt":
        return <span>{formatDate(d.createdAt)}</span>;
      default: {
        const cfId = customFieldIdFromColumn(columnId);
        return <span>{formatCustomFieldValue(cfId ? d.customFields?.[cfId] : undefined)}</span>;
      }
    }
  };

  const open = (e: MouseEvent, d: Deal) => {
    if (wantsNewTab(e)) {
      window.open(`/deals/${d.id}`, "_blank", "noopener,noreferrer");
      return;
    }
    onRowClick?.(d);
  };

  const sortedBar =
    sort === "day_desc"
      ? "shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.6)]"
      : sort === "none" || sort === "day_asc"
        ? "shadow-[inset_0_3px_0_0_rgba(0,0,0,0.6)]"
        : "";

  return (
    <div className="relative overflow-x-auto border-y border-[#dddddd]">
      {/*
        `table-fixed` with a declared width per column. A contact (a number,
        an email) lands a frame after the rows, and with auto layout every
        column re-measures when it does — the whole grid jumps under the
        reader's cursor. Fixed widths make the first painted frame the final
        one, whatever fills in afterwards.
      */}
      <Table className="table-fixed" contained={false} style={{ width: tableWidth(columns, widthOf) }}>
        <colgroup>
          <col style={{ width: widthOf(NUMBER_COLUMN) }} />
          {columns.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className={cn("border-0 hover:bg-transparent", deals.length === 0 && "opacity-50")}>
            <ResizableHead
              columnId={NUMBER_COLUMN}
              label="Job ID"
              width={widthOf(NUMBER_COLUMN)}
              onResize={(px) => setWidth(NUMBER_COLUMN, px)}
              onReset={reset}
              className={HEAD}
            >
              Job ID
            </ResizableHead>
            {columns.map((c) => (
              <ResizableHead
                key={c.id}
                columnId={c.id}
                label={c.label}
                width={widthOf(c.id)}
                onResize={(px) => setWidth(c.id, px)}
                onReset={reset}
                className={cn(HEAD, c.id === "scheduled" && [sortedBar, onSortScheduled && "cursor-pointer"])}
              >
                {c.id === "scheduled" && onSortScheduled ? (
                  <button
                    type="button"
                    aria-label={`Sort by Scheduled, ${sort === "day_desc" ? "latest first" : "soonest first"}`}
                    onClick={onSortScheduled}
                    className="w-full truncate text-left font-medium"
                  >
                    {c.label}
                  </button>
                ) : (
                  c.label
                )}
              </ResizableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((d) => (
            <TableRow
              key={d.id}
              // Workiz: rgba(0,0,0,.05) under the cursor, over the zebra too.
              className="group/row cursor-pointer border-0 hover:bg-black/5!"
              // A row click opens the job, as Workiz does; with ⌘/Ctrl, or
              // the middle button, it opens in a new tab instead. Right click
              // goes straight to a new tab in place of the browser menu.
              onClick={(e) => open(e, d)}
              onAuxClick={(e) => {
                if (e.button === 1) open(e, d);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                window.open(`/deals/${d.id}`, "_blank", "noopener,noreferrer");
              }}
            >
              <TableCell className={cn(CELL, "group/id")}>
                <div className="whitespace-nowrap">{d.dealNumber}</div>
                {/* Workiz shows "Quick view" under the ID while the cursor is on it. */}
                <button
                  type="button"
                  aria-label={`Quick view ${d.dealNumber}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(d);
                  }}
                  onContextMenu={(e) => e.stopPropagation()}
                  className="mt-[5px] rounded-[3px] bg-[#61747d] px-1 py-px text-xs leading-4 font-medium tracking-[0.4px] text-white opacity-0 group-hover/id:opacity-100 focus-visible:opacity-100"
                >
                  Quick view
                </button>
              </TableCell>
              {columns.map((c) => (
                // A long address or note is clipped, not allowed to widen its
                // column and shove the rest of the row sideways.
                <TableCell key={c.id} className={CELL}>
                  {cell(d, c.id)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {/* Workiz's grid never runs shorter than ten rows (react-table
              `minRows`): blank striped rows, 57px each, keep the rules going. */}
          {Array.from({ length: Math.max(0, MIN_ROWS - deals.length) }, (_, i) => (
            <TableRow key={`pad-${i}`} aria-hidden className="h-[57px] border-0 hover:bg-transparent">
              <TableCell className={CELL} />
              {columns.map((c) => (
                <TableCell key={c.id} className={CELL} />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {deals.length === 0 ? (
        // jobslist_wz_search_zzqxwv: 20px #3e4b51, 252px into the blank rows.
        <h3 className="pointer-events-none absolute inset-x-0 top-[294px] text-center text-xl leading-[25px] font-normal text-[#3e4b51]">
          {emptyText}
        </h3>
      ) : null}
    </div>
  );
}

/** Workiz pads its grid to this many rows. */
const MIN_ROWS = 10;

/**
 * The Scheduled cell, Workiz's four lines: the visit on the account's clock;
 * when the job sits in another zone, its place and its own clock (11px); and
 * how far off it is (12px/500, grey ahead, red once passed). A closed job's
 * passed visit is history, not late — it keeps quiet.
 */
function ScheduledCell({ deal, zone, accountZone, now }: { deal: Deal; zone?: string; accountZone: string; now: Date }) {
  const c = workizScheduleCell(
    { scheduledDate: deal.scheduledDate, scheduledTimeSlot: deal.allDay ? undefined : deal.scheduledTimeSlot, city: deal.address?.city, zone },
    accountZone,
    now,
  );
  const quiet = isTerminalStatus(deal.superStatus) || deal.superStatus === JobSuperStatus.DONE_PENDING_APPROVAL;
  return (
    <>
      <div className="leading-4 whitespace-nowrap">{c.when}</div>
      {c.area ? (
        <div className="mt-[3px] text-[11px] leading-[13px] whitespace-nowrap text-[#3b4b52]">
          <div>{c.area.place}:</div>
          <div>{c.area.when}</div>
        </div>
      ) : null}
      {c.relative && !quiet ? (
        <div
          className={cn(
            "mt-[5px] text-xs leading-[13px] font-medium whitespace-nowrap",
            c.past ? "text-[#f45e44]" : "text-[#61747d]",
          )}
        >
          {c.relative}
        </div>
      ) : null}
    </>
  );
}

