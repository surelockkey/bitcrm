"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Contact, Deal, User } from "@bitcrm/types";
import {
  extensionOf,
  formatAddress,
  formatPhoneWithExtension,
  primaryPhone,
  primaryEmail,
} from "@/features/clients/lib";
import { formatDate } from "@/features/users/lib";
import { useJobTypeName } from "@/features/job-types/lib";
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
  type VisibleFields,
} from "../fields";
import { dealClientName, formatSchedule, isUrgent, scheduleRelative } from "../lib";
import { TechChips } from "./assigned-techs";
import { PriorityFlag, StageBadge } from "./deal-badges";

/** "RESIDENTIAL" → "Residential", "IN_PROGRESS" → "In progress". */
const pretty = (v?: string) =>
  v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") : "—";

const money = (n?: number) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");

export function DealsTable({
  deals,
  contactMap,
  userMap,
  onOpen,
  visibleFields = DEFAULT_VISIBLE,
}: {
  deals: Deal[];
  contactMap: Map<string, Contact>;
  userMap: Map<string, User>;
  onOpen: (deal: Deal) => void;
  visibleFields?: VisibleFields;
}) {
  const jobTypeName = useJobTypeName();
  const sourceName = useJobSourceName();
  const externalCompanyName = useExternalCompanyName();
  const subStatusName = useJobStatusName();
  const { data: customFieldDefs } = useCustomFields();
  const todayIso = new Date().toISOString().slice(0, 10);

  // Every offerable field (static + active custom), narrowed to what's toggled on.
  const columns = jobFieldOptions(customFieldDefs).filter((c) => visibleFields[c.id]);

  const personName = (id?: string) => {
    const u = id ? userMap.get(id) : undefined;
    return u ? `${u.firstName} ${u.lastName}`.trim() || "—" : "—";
  };

  const cell = (d: Deal, columnId: string): ReactNode => {
    const contact = contactMap.get(d.contactId);
    const phone = contact ? primaryPhone(contact) : undefined;
    const email = contact ? primaryEmail(contact) : undefined;

    switch (columnId) {
      case "client":
        return (
          <>
            <div className="flex items-center gap-2">
              <span className="font-medium">{dealClientName(d, contact)}</span>
              {isUrgent(d) ? <PriorityFlag /> : null}
            </div>
            {phone ? (
              <div className="text-xs text-muted-foreground">
                {formatPhoneWithExtension(phone, contact ? extensionOf(contact, phone) : "")}
              </div>
            ) : email ? (
              <div className="text-xs text-muted-foreground">{email}</div>
            ) : null}
          </>
        );
      case "phone":
        return (
          <span className="text-sm">
            {phone
              ? formatPhoneWithExtension(phone, contact ? extensionOf(contact, phone) : "")
              : "—"}
          </span>
        );
      case "email":
        return <span className="text-sm">{email ?? "—"}</span>;
      case "clientType":
        return <span className="text-sm">{pretty(d.clientType)}</span>;
      case "tech":
        return <TechChips techIds={d.assignedTechIds} userMap={userMap} size="xs" emptyText="—" />;
      case "dispatcher":
        return <span className="text-sm">{personName(d.assignedDispatcherId)}</span>;
      case "tags":
        return d.tagIds?.length ? <JobTagChips ids={d.tagIds} max={3} /> : <span className="text-muted-foreground">—</span>;
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
        const rel = scheduleRelative(d.scheduledDate, todayIso);
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
      case "jobType":
        return <span className="text-sm">{jobTypeName(d.jobTypeId)}</span>;
      case "source":
        return <span className="text-sm">{sourceName(d.sourceId)}</span>;
      case "externalCompany":
        return <span className="text-sm">{externalCompanyName(d.externalCompanyId)}</span>;
      case "poNumber":
        return <span className="text-sm">{d.poNumber || "—"}</span>;
      case "total":
        return <span className="text-sm tabular-nums">{money(d.actualTotal ?? d.estimatedTotal)}</span>;
      case "paymentStatus":
        return <span className="text-sm">{d.paymentStatus ? pretty(d.paymentStatus) : "—"}</span>;
      case "notes":
        return <span className="block max-w-56 truncate text-sm text-muted-foreground">{d.notes || "—"}</span>;
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
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16">Job&nbsp;#</TableHead>
            {columns.map((c) => (
              <TableHead key={c.id}>{c.label}</TableHead>
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
                <TableCell key={c.id}>{cell(d, c.id)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
