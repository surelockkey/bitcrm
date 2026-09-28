"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, Eye } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { Contact, Deal, PersonName, User } from "@bitcrm/types";
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
import {
  DEFAULT_VISIBLE,
  customFieldIdFromColumn,
  formatCustomFieldValue,
  jobFieldOptions,
  JOB_NUMBER_WIDTH,
  type VisibleFields,
} from "../fields";
import {
  SEND_TO_TECH_CHANNEL_LABEL,
  dealClientName,
  formatSchedule,
  formatStamp,
  isUrgent,
  scheduleMarker,
} from "../lib";
import { TechChips } from "./assigned-techs";
import { TechCell } from "./tech-cell";
import { noteToText } from "../note-html";
import { PriorityFlag, StageBadge } from "./deal-badges";
import type { DirectoryUser } from "@/features/deals/hooks";

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
  rows = 12,
}: {
  visibleFields?: VisibleFields;
  rows?: number;
}) {
  const { data: customFieldDefs } = useCustomFields();
  const columns = jobFieldOptions(customFieldDefs).filter((c) => visibleFields[c.id]);

  return (
    <div className="overflow-x-auto border" aria-busy role="status" aria-label="Loading jobs">
      <Table className="table-fixed">
        <colgroup>
          <col style={{ width: JOB_NUMBER_WIDTH }} />
          {columns.map((c) => (
            <col key={c.id} style={{ width: c.width }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="truncate">Job&nbsp;#</TableHead>
            {columns.map((c) => (
              <TableHead key={c.id} className="truncate">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              <TableCell>
                <Skeleton className="h-4 w-12" />
              </TableCell>
              {columns.map((c) => (
                <TableCell key={c.id}>
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

/** "RESIDENTIAL" → "Residential", "IN_PROGRESS" → "In progress". */
const pretty = (v?: string) =>
  v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") : "—";

const money = (n?: number) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");

/** No side-loaded names — a stable identity, so it never re-renders the grid. */
const NO_NAMES: Map<string, PersonName> = new Map();

export function DealsTable({
  deals,
  contactMap,
  clientNames = NO_NAMES,
  userMap,
  namesLoading = false,
  onOpen,
  visibleFields = DEFAULT_VISIBLE,
}: {
  deals: Deal[];
  /**
   * The contacts behind the rows — the only source of a client's number or
   * email. Empty when no column shows either: the list then names its clients
   * from `clientNames` and asks crm for nothing.
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
  onOpen: (deal: Deal) => void;
  visibleFields?: VisibleFields;
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

  // Every offerable field (static + active custom), narrowed to what's toggled on.
  const columns = jobFieldOptions(customFieldDefs).filter((c) => visibleFields[c.id]);

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
              <span className="font-medium">
                {dealClientName(d, contact, clientNames.get(d.contactId))}
              </span>
              {isUrgent(d) ? <PriorityFlag /> : null}
            </div>
            {phone ? (
              <div className="text-xs text-muted-foreground">
                {formatPhoneWithExtension(phone, phoneExt)}
              </div>
            ) : email ? (
              <div className="text-xs text-muted-foreground">{email}</div>
            ) : null}
          </>
        );
      case "phone":
        return (
          <span className="text-sm">
            {phone ? formatPhoneWithExtension(phone, phoneExt) : "—"}
          </span>
        );
      case "email":
        return <span className="text-sm">{email ?? "—"}</span>;
      case "clientType":
        return <span className="text-sm">{pretty(d.clientType)}</span>;
      case "tech":
        return <TechCell deal={d} userMap={userMap} />;
      case "dispatcher":
        return <span className="text-sm">{personCell(d.assignedDispatcherId)}</span>;
      case "tags":
        return d.tagIds?.length ? <JobTagChips ids={d.tagIds} max={3} solid /> : <span className="text-muted-foreground">—</span>;
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
        return <span className="text-sm">{pretty(d.priority)}</span>;
      case "city":
        return <span className="text-sm text-muted-foreground">{d.address?.city || "—"}</span>;
      case "state":
        return <span className="text-sm text-muted-foreground">{d.address?.state || "—"}</span>;
      case "zip":
        return <span className="text-sm text-muted-foreground">{d.address?.zip || "—"}</span>;
      case "address":
        return <span className="text-sm text-muted-foreground">{d.address ? formatAddress(d.address) : "—"}</span>;
      case "serviceArea":
        return <span className="text-sm text-muted-foreground">{d.serviceArea || "—"}</span>;
      case "scheduled": {
        const rel = scheduleMarker(d);
        return (
          <>
            <div className="text-sm">{formatSchedule(d.scheduledDate, d.scheduledTimeSlot)}</div>
            {rel ? (
              <div
                className={
                  rel.tone === "overdue"
                    ? "text-xs text-red-600 dark:text-red-400"
                    : rel.tone === "soon"
                      ? "text-xs text-amber-600 dark:text-amber-400"
                      : "text-xs text-muted-foreground"
                }
              >
                {rel.label}
              </div>
            ) : null}
          </>
        );
      }
      case "sent": {
        // Workiz `last_sent`: the click, with the channels it went out on.
        if (!d.sentToTechAt) return <span className="text-sm text-muted-foreground">—</span>;
        const via = (d.sentToTechVia ?? [])
          .map((c) => SEND_TO_TECH_CHANNEL_LABEL[c])
          .filter(Boolean)
          .join(" & ");
        return (
          <>
            <div className="text-sm">{formatStamp(d.sentToTechAt)}</div>
            {via ? <div className="text-xs text-muted-foreground">{via}</div> : null}
          </>
        );
      }
      case "seen":
        // Workiz `seen`: the first technician to open the job in their app.
        return d.seenByTechAt ? (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
            <Eye className="size-3.5" /> {formatStamp(d.seenByTechAt)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      case "jobType":
        return (
          <span className="text-sm">
            {d.jobTypeId && jobTypesLoading ? pendingLine : jobTypeName(d.jobTypeId)}
          </span>
        );
      case "source":
        return <span className="text-sm">{sourceName(d.sourceId)}</span>;
      case "externalCompany":
        return <span className="text-sm">{externalCompanyName(d.externalCompanyId)}</span>;
      case "company":
        // The name is snapshotted on the job, so no catalog lookup is needed.
        return <span className="text-sm">{d.businessProfileName ?? "—"}</span>;
      case "poNumber":
        return <span className="text-sm">{d.poNumber || "—"}</span>;
      case "total":
        return <span className="text-sm tabular-nums">{money(d.actualTotal ?? d.estimatedTotal)}</span>;
      case "paymentStatus":
        return <span className="text-sm">{d.paymentStatus ? pretty(d.paymentStatus) : "—"}</span>;
      case "notes":
        return <span className="block max-w-56 truncate text-sm text-muted-foreground">{noteToText(d.notes) || "—"}</span>;
      case "createdBy":
        return <span className="text-sm">{personName(d.createdBy)}</span>;
      case "createdAt":
        return <span className="text-sm text-muted-foreground">{formatDate(d.createdAt)}</span>;
      default: {
        const cfId = customFieldIdFromColumn(columnId);
        return (
          <span className="text-sm">
            {formatCustomFieldValue(cfId ? d.customFields?.[cfId] : undefined)}
          </span>
        );
      }
    }
  };

  return (
    <div className="overflow-x-auto border">
      {/*
        `table-fixed` with a declared width per column. Names now arrive with
        the rows, but a contact (a number, an email) still lands a frame or
        two later, and with auto layout every column re-measures when it does
        — the whole grid jumps under the reader's cursor. Fixed widths make
        the first painted frame the final one, whatever fills in afterwards.
      */}
      <Table className="table-fixed">
        <colgroup>
          <col style={{ width: JOB_NUMBER_WIDTH }} />
          {columns.map((c) => (
            <col key={c.id} style={{ width: c.width }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="truncate">Job&nbsp;#</TableHead>
            {columns.map((c) => (
              <TableHead key={c.id} className="truncate">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((d) => (
            <TableRow
              key={d.id}
              className="cursor-pointer align-top"
              // Left click anywhere on the row opens the quick-view drawer;
              // right click jumps straight into the job in a new tab in
              // place of the browser menu.
              onClick={() => onOpen(d)}
              onContextMenu={(e) => {
                e.preventDefault();
                window.open(`/deals/${d.id}`, "_blank", "noopener,noreferrer");
              }}
            >
              <TableCell className="font-mono text-xs">
                {/* The number doubles as the open-in-new-tab link so it's
                    reachable right next to the nav, not across the row;
                    stopPropagation keeps the row click (preview drawer)
                    from also firing. */}
                <Link
                  href={`/deals/${d.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open job #${d.dealNumber} in new tab`}
                  title="Open in new tab"
                  onClick={(e) => e.stopPropagation()}
                  // A real link keeps its native right-click menu (copy
                  // address, etc.) — don't swallow it with the row preview.
                  onContextMenu={(e) => e.stopPropagation()}
                  className="-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground underline-offset-2 hover:bg-accent hover:text-foreground hover:underline"
                >
                  #{d.dealNumber}
                  <ExternalLink className="size-3" />
                </Link>
              </TableCell>
              {columns.map((c) => (
                // A long address or note is clipped, not allowed to widen its
                // column and shove the rest of the row sideways.
                <TableCell key={c.id} className="overflow-hidden">
                  {cell(d, c.id)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
