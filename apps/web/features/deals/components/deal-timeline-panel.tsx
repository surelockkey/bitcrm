"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  CheckCheck,
  ChevronDown,
  Eye,
  FileX,
  History,
  Loader2,
  MapPinCheck,
  MessageSquare,
  MessagesSquare,
  MoreVertical,
  PackageMinus,
  PackageOpen,
  PackagePlus,
  Paperclip,
  Pencil,
  Percent,
  Phone,
  Receipt,
  FileCheck2,
  FileText,
  Send,
  PhoneCall,
  PhoneOff,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
  Undo2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { TimelineEventType } from "@bitcrm/types";
import type { SendToTechChannel, TimelineEntry } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { DEFAULT_TZ } from "@/lib/timezone";
import { formatDuration } from "@/features/calls/lib";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useExternalCompanies } from "@/features/external-companies/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { SEND_TO_TECH_CHANNEL_LABEL, stageLabel, superStatusLabel } from "../lib";
import {
  useAddNote,
  useDealTimeline,
  useDeleteNote,
  useUpdateNote,
  useUserMap,
} from "../hooks";
import { useContactsByIds } from "@/features/clients/hooks";
import { ClientChatSheet } from "@/features/clients/components/client-chat-sheet";
import {
  JOB_TIMELINE_FILTERS,
  filterOptionLabel,
  matchesFilter,
  notesBadge,
  relativeTime,
  timelineCounts,
  type TimelineFilter,
} from "../timeline-rail";

/* ----------------------------------------------------------- event meta */

const META: Record<TimelineEventType, { icon: typeof Sparkles; label: string }> = {
  [TimelineEventType.CREATED]: { icon: Sparkles, label: "Job created" },
  [TimelineEventType.STATUS_CHANGED]: { icon: ArrowRight, label: "Status changed" },
  [TimelineEventType.STAGE_CHANGED]: { icon: ArrowRight, label: "Stage changed" },
  [TimelineEventType.FIELD_UPDATED]: { icon: Pencil, label: "Field updated" },
  [TimelineEventType.NOTE_ADDED]: { icon: MessageSquare, label: "Note" },
  [TimelineEventType.TECH_ASSIGNED]: { icon: UserPlus, label: "Technician assigned" },
  [TimelineEventType.TECH_UNASSIGNED]: { icon: UserMinus, label: "Technician unassigned" },
  [TimelineEventType.PRODUCT_ADDED]: { icon: PackagePlus, label: "Product added" },
  [TimelineEventType.PRODUCT_UPDATED]: { icon: PackageOpen, label: "Product updated" },
  [TimelineEventType.PRODUCT_REMOVED]: { icon: PackageMinus, label: "Product removed" },
  [TimelineEventType.CALL_LINKED]: { icon: PhoneCall, label: "Call linked" },
  [TimelineEventType.CALL_UNLINKED]: { icon: PhoneOff, label: "Call unlinked" },
  [TimelineEventType.TECH_CONFIRMED]: { icon: CheckCheck, label: "Job receipt confirmed" },
  [TimelineEventType.TECH_ARRIVED]: { icon: MapPinCheck, label: "Arrived at location" },
  [TimelineEventType.ATTACHMENT_ADDED]: { icon: Paperclip, label: "File added" },
  [TimelineEventType.ATTACHMENT_RENAMED]: { icon: Paperclip, label: "File renamed" },
  [TimelineEventType.ATTACHMENT_REMOVED]: { icon: FileX, label: "File removed" },
  // Workiz "Sent to tech by SMS / In App / Email" and "Viewed job in app".
  [TimelineEventType.SENT_TO_TECH]: { icon: Send, label: "Sent to tech" },
  [TimelineEventType.SEEN_BY_TECH]: { icon: Eye, label: "Viewed job in app" },
  [TimelineEventType.TAX_CHANGED]: { icon: Percent, label: "Tax changed" },
  [TimelineEventType.DISCOUNT_CHANGED]: { icon: Percent, label: "Discount changed" },
  [TimelineEventType.INVOICE_CREATED]: { icon: Receipt, label: "Invoice created" },
  [TimelineEventType.INVOICE_UPDATED]: { icon: Receipt, label: "Invoice updated" },
  [TimelineEventType.INVOICE_SENT]: { icon: Send, label: "Invoice sent" },
  [TimelineEventType.INVOICE_DELETED]: { icon: FileX, label: "Invoice deleted" },
  [TimelineEventType.ESTIMATE_CREATED]: { icon: FileText, label: "Estimate created" },
  [TimelineEventType.ESTIMATE_STATUS_CHANGED]: { icon: FileText, label: "Estimate status changed" },
  [TimelineEventType.ESTIMATE_SENT]: { icon: Send, label: "Estimate sent" },
  [TimelineEventType.ESTIMATE_SYNCED]: { icon: FileCheck2, label: "Estimate synced to job" },
  [TimelineEventType.ESTIMATE_DELETED]: { icon: FileX, label: "Estimate deleted" },
  // The client's own decisions on the portal (Workiz "Client signed estimate").
  // What the client did on the portal, in Workiz's words.
  [TimelineEventType.ESTIMATE_APPROVED]: { icon: FileCheck2, label: "Client signed estimate" },
  [TimelineEventType.ESTIMATE_DECLINED]: { icon: FileX, label: "Client declined estimate" },
  [TimelineEventType.ESTIMATE_VIEWED]: { icon: Eye, label: "Client viewed estimate" },
  [TimelineEventType.INVOICE_VIEWED]: { icon: Eye, label: "Client viewed invoice" },
  [TimelineEventType.PROPOSAL_SENT]: { icon: Send, label: "Proposal sent" },
  [TimelineEventType.INVOICE_SIGNED]: { icon: FileCheck2, label: "Invoice signed" },
  [TimelineEventType.PAYMENT_RECEIVED]: { icon: BadgeDollarSign, label: "Payment received" },
  // Taken but not landed yet — an ACH debit in transit.
  [TimelineEventType.PAYMENT_PENDING]: { icon: BadgeDollarSign, label: "Payment clearing" },
  [TimelineEventType.PAYMENT_FAILED]: { icon: X, label: "Payment failed" },
  [TimelineEventType.PAYMENT_REFUNDED]: { icon: Undo2, label: "Payment refunded" },
  // Settled money pulled back afterwards (ACH return, dispute lost).
  [TimelineEventType.PAYMENT_REVERSED]: { icon: Undo2, label: "Payment reversed" },
};

const FIELD_LABEL: Record<string, string> = {
  notes: "Notes",
  internalNotes: "Internal notes",
  scheduledDate: "Scheduled date",
  scheduledEndDate: "End date",
  scheduledTimeSlot: "Time slot",
  allDay: "All day",
  serviceArea: "Service area",
  serviceAreaId: "Service area",
  jobTypeId: "Job type",
  sourceId: "Source",
  externalCompanyId: "External company",
  priority: "Priority",
  poNumber: "PO number",
  workOrderId: "Work order",
  address: "Address",
  tagIds: "Tags",
  paymentStatus: "Payment status",
  actualTotal: "Amount",
  assignedTechIds: "Team",
  cancellationReason: "Cancellation reason",
  clientType: "Client type",
  clientName: "Client name",
  contactId: "Client",
  subStatusId: "Sub-status",
  jobName: "Job name",
};

/** A signature the client gave on the portal (actor "client") reads as Workiz's "Client signed invoice". */
function labelOf(entry: TimelineEntry): string {
  if (entry.eventType === TimelineEventType.INVOICE_SIGNED && entry.actorId === "client") return "Client signed invoice";
  return (META[entry.eventType] ?? LEGACY_META[entry.eventType] ?? fallbackMeta(entry.eventType)).label;
}

/** The client's portal events name their document: "#O8E9NQ". */
const DOCUMENT_EVENTS = new Set<string>([
  TimelineEventType.ESTIMATE_VIEWED,
  TimelineEventType.INVOICE_VIEWED,
  TimelineEventType.ESTIMATE_APPROVED,
  TimelineEventType.ESTIMATE_DECLINED,
  TimelineEventType.INVOICE_SIGNED,
]);

/** Backend-generated keys carry structure: `sequences.<techId>`, `product.<id>.ordered`. */
function fieldLabel(key: string, lk: Lookups): string {
  if (key.startsWith("sequences.")) {
    const tech = lk.userName(key.slice("sequences.".length));
    return tech ? `Route position (${tech})` : "Route position";
  }
  if (key.startsWith("product.") && key.endsWith(".ordered")) return "Ordered";
  return FIELD_LABEL[key] ?? key;
}

/* --------------------------------------------------------------- lookups */

/**
 * Entries store raw ids (job type, sub-status, tech, client, tag…). The reader
 * should never see one — these catalogs turn every id into the name people
 * actually know the thing by. All are small cached lists already loaded elsewhere
 * on the job page, so this adds no new traffic.
 */
export interface Lookups {
  userName: (id: unknown) => string | null;
  contactName: (id: unknown) => string | null;
  jobTypes: Map<string, string>;
  sources: Map<string, string>;
  externalCompanies: Map<string, string>;
  subStatuses: Map<string, string>;
  tags: Map<string, string>;
}

export function useTimelineLookups(contactIds: string[]): Lookups {
  const { map: userMap } = useUserMap();
  // Only the clients the entries mention — a "Client" change names two.
  const { map: contactMap } = useContactsByIds(contactIds);
  const jobTypes = useJobTypes().data;
  const sources = useJobSources().data;
  const externalCompanies = useExternalCompanies().data;
  const subStatuses = useJobStatuses().data;
  const tags = useJobTags().data;

  return useMemo(() => {
    const named = (list: { id: string; name: string }[] | undefined) =>
      new Map((list ?? []).map((x) => [x.id, x.name]));
    return {
      userName: (id) => {
        const u = typeof id === "string" ? userMap.get(id) : undefined;
        const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
        return name || null;
      },
      contactName: (id) => {
        const c = typeof id === "string" ? contactMap.get(id) : undefined;
        const name = c ? `${c.firstName} ${c.lastName}`.trim() : "";
        return name || null;
      },
      jobTypes: named(jobTypes),
      sources: named(sources),
      externalCompanies: named(externalCompanies),
      subStatuses: named(subStatuses),
      tags: named(tags),
    };
  }, [userMap, contactMap, jobTypes, sources, externalCompanies, subStatuses, tags]);
}

/* ------------------------------------------------------------ rendering */

/** Item money/quantity edits logged by product_updated entries. */
const CHANGE_LABEL: Record<string, { label: string; money: boolean }> = {
  priceClient: { label: "Price", money: true },
  costCompany: { label: "Cost (company)", money: true },
  costForTech: { label: "Cost (tech)", money: true },
  quantity: { label: "Qty", money: false },
};

/** "Price: $45.00 → $60.00" lines from a product_updated changes map. */
function itemChangeLines(entry: TimelineEntry): string[] {
  if (entry.eventType !== TimelineEventType.PRODUCT_UPDATED) return [];
  const changes = entry.details?.changes as
    | Record<string, { from: unknown; to: unknown }>
    | undefined;
  if (!changes) return [];
  return Object.entries(changes)
    .filter(([k]) => CHANGE_LABEL[k])
    .map(([k, v]) => {
      const meta = CHANGE_LABEL[k];
      const fmt = (n: unknown) =>
        meta.money && typeof n === "number" ? `$${n.toFixed(2)}` : fmtValue(n);
      return `${meta.label}: ${fmt(v.from)} → ${fmt(v.to)}`;
    });
}

/**
 * Imported Workiz activity lines that match none of our events keep their
 * text as the note and are typed `workiz_activity`; they read as "Activity".
 */
const LEGACY_META: Record<string, { icon: typeof Sparkles; label: string }> = {
  workiz_activity: { icon: Sparkles, label: "Activity" },
};

/** `some_event_type` → "Some event type", for a type no map knows. */
const fallbackMeta = (eventType: string) => ({
  icon: Sparkles,
  label: eventType ? eventType.charAt(0).toUpperCase() + eventType.slice(1).replace(/_/g, " ") : "Event",
});

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** A logged ISO timestamp (schedule change…) read on business time, e.g. "Sep 30, 2026, 10:00 AM". */
function fmtInstant(iso: string): string {
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime())
    ? iso
    : dt.toLocaleString("en-US", { timeZone: DEFAULT_TZ, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Render a logged value: addresses/arrays flattened, dates on business time, empty as an em-dash. */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && ISO_INSTANT.test(v)) return fmtInstant(v);
  if (Array.isArray(v)) return v.length ? v.map(fmtValue).join(", ") : "—";
  if (typeof v === "object") {
    const a = v as Record<string, unknown>;
    if (typeof a.street === "string") {
      return [a.street, a.unit, a.city, a.state, a.zip].filter(Boolean).join(", ");
    }
    // A name pair ("Just here" client rename) reads as the name itself.
    if (typeof a.firstName === "string" || typeof a.lastName === "string") {
      return `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || "—";
    }
    return JSON.stringify(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** `snake_case` enum values (priority, client type…) → "Snake case". */
function humanizeEnum(v: unknown): string {
  if (typeof v !== "string" || !v) return fmtValue(v);
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A field-change value, resolved through the catalogs the id points into. */
function resolveFieldValue(field: string, v: unknown, lk: Lookups): string {
  if (v === null || v === undefined || v === "") return "—";
  const viaMap = (m: Map<string, string>) =>
    typeof v === "string" ? m.get(v) ?? v : fmtValue(v);
  switch (field) {
    case "jobTypeId":
      return viaMap(lk.jobTypes);
    case "sourceId":
      return viaMap(lk.sources);
    case "externalCompanyId":
      return viaMap(lk.externalCompanies);
    case "subStatusId":
      return viaMap(lk.subStatuses);
    case "contactId":
      return (typeof v === "string" && lk.contactName(v)) || fmtValue(v);
    case "tagIds":
      return Array.isArray(v) && v.length
        ? v.map((id) => (typeof id === "string" ? lk.tags.get(id) ?? id : fmtValue(id))).join(", ")
        : "—";
    case "assignedTechIds":
      return Array.isArray(v) && v.length
        ? v.map((id) => lk.userName(id) ?? fmtValue(id)).join(", ")
        : "—";
    case "priority":
    case "clientType":
    case "paymentStatus":
      return humanizeEnum(v);
    default:
      return fmtValue(v);
  }
}

/** One-line "what changed, from what to what" for an entry. */
function detail(entry: TimelineEntry, lk: Lookups): string | null {
  const d = entry.details ?? {};
  if (entry.eventType === TimelineEventType.STATUS_CHANGED) {
    const from = d.fromStatus as string | undefined;
    const to = d.toStatus as string | undefined;
    if (from && to) {
      const base = `${superStatusLabel(from as never)} → ${superStatusLabel(to as never)}`;
      const sub =
        typeof d.subStatusId === "string" ? lk.subStatuses.get(d.subStatusId) : undefined;
      return sub ? `${base} · ${sub}` : base;
    }
  }
  if (entry.eventType === TimelineEventType.STAGE_CHANGED) {
    const from = d.fromStage as string | undefined;
    const to = d.toStage as string | undefined;
    if (from && to) return `${stageLabel(from as never)} → ${stageLabel(to as never)}`;
  }
  if (entry.eventType === TimelineEventType.FIELD_UPDATED && typeof d.field === "string") {
    const label = fieldLabel(d.field, lk);
    const val = (v: unknown) => resolveFieldValue(d.field as string, v, lk);
    if ("oldValue" in d) return `${label}: ${val(d.oldValue)} → ${val(d.newValue)}`;
    // Legacy entries logged only the new value.
    if ("newValue" in d) return `${label} → ${val(d.newValue)}`;
    return label;
  }
  if (
    entry.eventType === TimelineEventType.TECH_ASSIGNED ||
    entry.eventType === TimelineEventType.TECH_UNASSIGNED
  ) {
    // The one thing that matters here is *which* technician.
    return lk.userName(d.techId ?? d.previousTechId);
  }
  if (
    entry.eventType === TimelineEventType.TECH_CONFIRMED ||
    entry.eventType === TimelineEventType.TECH_ARRIVED
  ) {
    // Who said so, and — on an arrival the phone could place — that it was
    // located. The coordinates themselves belong on the map, not in a feed.
    const parts = [lk.userName(d.techId)].filter(Boolean) as string[];
    if (entry.eventType === TimelineEventType.TECH_ARRIVED && d.location) {
      parts.push("location recorded");
    }
    const sub = typeof d.subStatusId === "string" ? lk.subStatuses.get(d.subStatusId) : undefined;
    if (sub) parts.push(sub);
    return parts.length ? parts.join(" · ") : null;
  }
  if (
    entry.eventType === TimelineEventType.PRODUCT_ADDED ||
    entry.eventType === TimelineEventType.PRODUCT_REMOVED
  ) {
    const name = (d.productName ?? d.name) as string | undefined;
    const qty = (d.quantity ?? d.qty) as number | undefined;
    if (name) return qty ? `${name} ×${qty}` : name;
  }
  if (
    entry.eventType === TimelineEventType.CALL_LINKED ||
    entry.eventType === TimelineEventType.CALL_UNLINKED
  ) {
    // Direction, who with, and how long — enough to recognise the call
    // without leaving the job.
    const direction = d.direction === "inbound" ? "Incoming" : "Outgoing";
    const other = (d.direction === "inbound" ? d.from : d.to) as
      | string
      | undefined;
    const parts = [direction];
    if (other) parts.push(formatPhone(other));
    if (typeof d.durationSeconds === "number") {
      parts.push(formatDuration(d.durationSeconds));
    }
    if (d.hasRecording) parts.push("recorded");
    return parts.join(" · ");
  }
  if (entry.eventType === TimelineEventType.PRODUCT_UPDATED) {
    const name = d.productName as string | undefined;
    const prev = d.previousProductName as string | undefined;
    const qty = d.quantity as number | undefined;
    // A swap names both products; an in-place edit just the one.
    const label = prev && prev !== name ? `${prev} → ${name}` : name;
    if (label) return qty ? `${label} ×${qty}` : label;
  }
  if (entry.eventType === TimelineEventType.ATTACHMENT_ADDED) {
    const name = d.fileName as string | undefined;
    const category = d.category as string | undefined;
    if (name) return category ? `${name} · ${category}` : name;
  }
  if (entry.eventType === TimelineEventType.ATTACHMENT_RENAMED) {
    const name = d.fileName as string | undefined;
    const prev = d.previousFileName as string | undefined;
    if (prev && name) return `${prev} → ${name}`;
    // Description-only edit: the name stayed.
    if (name) return `${name} · description updated`;
  }
  if (entry.eventType === TimelineEventType.ATTACHMENT_REMOVED) {
    const name = d.fileName as string | undefined;
    const category = d.category as string | undefined;
    if (name) return category ? `${name} · ${category}` : name;
  }
  if (entry.eventType === TimelineEventType.SENT_TO_TECH) {
    // Workiz's own wording: "Sent to tech by SMS · Ann Lee, Bob Ray".
    const channels = Array.isArray(d.channels) ? (d.channels as SendToTechChannel[]) : [];
    const via = channels.map((c) => SEND_TO_TECH_CHANNEL_LABEL[c] ?? c).join(" & ");
    const who = Array.isArray(d.techIds)
      ? (d.techIds as string[]).map((id) => lk.userName(id) ?? "…").join(", ")
      : "";
    return [via ? `by ${via}` : "", who].filter(Boolean).join(" · ") || null;
  }
  if (entry.eventType === TimelineEventType.SEEN_BY_TECH) {
    return typeof d.techId === "string" ? lk.userName(d.techId) : null;
  }
  if (DOCUMENT_EVENTS.has(entry.eventType) && typeof d.number === "string") {
    return `#${d.number}`;
  }
  return null;
}

function when(ts: string): string {
  const dt = new Date(ts);
  return Number.isNaN(dt.getTime())
    ? ts
    : dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* -------------------------------------------------------------- filters */

export { FILTERS, matchesFilter, type TimelineFilter } from "../timeline-rail";

export function entryHaystack(entry: TimelineEntry, lk: Lookups): string {
  return [labelOf(entry), detail(entry, lk), entry.note, entry.actorName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * The clients an entry set mentions (a "Client" change names two) — only those
 * are looked up by id, nothing is enumerated.
 */
export function mentionedContactIds(entries: TimelineEntry[]): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    const d = e.details as Record<string, unknown> | undefined;
    if (d?.field !== "contactId") continue;
    for (const v of [d.oldValue, d.newValue]) if (typeof v === "string") ids.add(v);
  }
  return [...ids];
}

/**
 * Entries store the actor's email; show the person's name when we know them
 * (system actors like "Payment Service" fall back to the stored label).
 */
export function actorLabel(
  e: TimelineEntry,
  userMap: Map<string, { firstName?: string; lastName?: string }>,
): string {
  const u = userMap.get(e.actorId);
  const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
  return name || e.actorName;
}

/* ------------------------------------------------------------------ rail */

/** The client the rail's chat icon and "Message Client" talk to. */
export interface RailClient {
  id: string;
  name: string;
  phone?: string;
}

/**
 * Workiz's right rail on the job page (job_b_03_rail*): a 55px strip down
 * the right edge — expand arrow, Timeline, notes (red count), calls, chat —
 * and, opened, a 350px Timeline panel that takes the strip's place and
 * narrows the page beside it. Every icon opens the same panel with its own
 * filter chosen; the chat icon opens the client's SMS thread, because BitCRM
 * keeps a job's texts in the Inbox rather than on the job.
 */
export function DealTimelinePanel({
  dealId,
  canEdit,
  client,
}: {
  dealId: string;
  canEdit: boolean;
  /** Present when the viewer may text the job's client. */
  client?: RailClient;
}) {
  const [open, setOpen] = useState(false);
  // Lives here, not in the panel, so it survives a close and reopen.
  const [filter, setFilter] = useState<TimelineFilter>("activities");
  const [chatOpen, setChatOpen] = useState(false);
  // The page asks for the first page with the job (job-page-data), so the
  // badge is there when the page shows.
  const query = useDealTimeline(dealId);
  const entries = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const counts = useMemo(() => timelineCounts(entries), [entries]);
  const hasMore = Boolean(query.hasNextPage);
  const badge = notesBadge(counts.notes, hasMore);

  const openWith = (f: TimelineFilter | null) => {
    if (f) setFilter(f);
    setOpen(true);
  };

  return (
    <>
      {open ? (
        <aside
          aria-label="Job timeline"
          // In the page's flow, narrowing it, as Workiz does; on a phone it
          // floats over the page instead of squeezing it to nothing.
          className="flex w-[350px] max-w-[85vw] shrink-0 flex-col overflow-hidden bg-white shadow-[-3px_0_8px_rgba(0,0,0,0.12)] max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40"
        >
          <PanelBody
            dealId={dealId}
            canEdit={canEdit}
            entries={entries}
            counts={counts}
            query={query}
            filter={filter}
            onFilterChange={setFilter}
            onClose={() => setOpen(false)}
            onMessageClient={client ? () => setChatOpen(true) : undefined}
          />
        </aside>
      ) : (
        <div
          role="toolbar"
          aria-label="Job rail"
          aria-orientation="vertical"
          className="flex w-[55px] shrink-0 flex-col items-center bg-white shadow-[-3px_0_8px_rgba(0,0,0,0.12)]"
        >
          {/* The 62px #f7f7f7 cap with Workiz's "←". */}
          <div className="flex h-[62px] w-full justify-center bg-[#f7f7f7] pt-2.5">
            <button
              type="button"
              aria-label="Expand panel"
              title="Expand"
              onClick={() => openWith(null)}
              className="grid h-8 w-[21px] place-items-center rounded-[8px] text-foreground hover:bg-white"
            >
              <ArrowLeft className="size-5" strokeWidth={1.25} />
            </button>
          </div>
          <RailIcon icon={History} label="Timeline" expanded={false} className="mt-[30px]" onClick={() => openWith("activities")} />
          <RailIcon icon={SquarePen} label="Notes" badge={badge} className="mt-[50px]" onClick={() => openWith("notes")} />
          <RailIcon icon={Phone} label="Calls" className="mt-[50px]" onClick={() => openWith("calls")} />
          {client ? (
            <RailIcon icon={MessagesSquare} label="Message client" className="mt-[50px]" onClick={() => setChatOpen(true)} />
          ) : null}
        </div>
      )}
      {client ? (
        <ClientChatSheet contactId={client.id} name={client.name} phone={client.phone} open={chatOpen} onOpenChange={setChatOpen} />
      ) : null}
    </>
  );
}

function RailIcon({
  icon: Icon,
  label,
  badge,
  expanded,
  className,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  badge?: string | null;
  expanded?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={badge ? `${label} (${badge})` : label}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
      className={cn("relative grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-[#f3f6f7]", className)}
    >
      <Icon className="size-[22px]" strokeWidth={1.25} />
      {badge ? (
        // Workiz: a 20px #f45e44 disc, 11px/500 white, riding the icon's top right.
        // (rounded-pill: a disc at one digit, a lozenge at "99+".)
        <span className="absolute -top-3.5 left-[13px] grid h-5 min-w-5 place-items-center rounded-pill bg-[#f45e44] px-1 text-[11px] leading-5 font-medium text-white tabular-nums">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/* ---------------------------------------------------------------- panel */

function PanelBody({
  dealId,
  canEdit,
  entries,
  counts,
  query,
  filter,
  onFilterChange,
  onClose,
  onMessageClient,
}: {
  dealId: string;
  canEdit: boolean;
  entries: TimelineEntry[];
  counts: Record<TimelineFilter, number>;
  query: ReturnType<typeof useDealTimeline>;
  filter: TimelineFilter;
  onFilterChange: (f: TimelineFilter) => void;
  onClose: () => void;
  onMessageClient?: () => void;
}) {
  const addNote = useAddNote(dealId);
  const updateNote = useUpdateNote(dealId);
  const deleteNote = useDeleteNote(dealId);
  const { map: userMap } = useUserMap();
  const lookups = useTimelineLookups(useMemo(() => mentionedContactIds(entries), [entries]));
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TimelineEntry | null>(null);
  const hasMore = Boolean(query.hasNextPage);

  const rows = useMemo(() => {
    let base = entries.filter((e) => matchesFilter(e, filter));
    const q = search.trim().toLowerCase();
    if (q) base = base.filter((e) => entryHaystack(e, lookups).includes(q));
    return [...base].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [entries, filter, search, lookups]);

  const submit = () => {
    const v = note.trim();
    if (!v) return;
    addNote.mutate(v, {
      onSuccess: () => {
        setNote("");
        setComposing(false);
      },
    });
  };

  return (
    <>
      {/* Head: 62px #f7f7f7, "→" closes, "Timeline" 18px/600 in the middle. */}
      <div className="relative flex h-[62px] shrink-0 items-start bg-[#f7f7f7] px-5 pt-2.5">
        <button
          type="button"
          aria-label="Close timeline"
          onClick={onClose}
          className="relative z-10 grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-white"
        >
          <ArrowRight className="size-5" strokeWidth={1.25} />
        </button>
        <h2 className="pointer-events-none absolute inset-x-0 top-3 pl-4 text-center text-[18px] leading-8 font-semibold text-foreground">
          Timeline
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The filter (or, after the magnifier, the search box). */}
        <div className="flex h-[64px] items-start gap-2 px-5 pt-5">
          {searching ? (
            <div className="relative w-[310px]">
              <input
                autoFocus
                placeholder="Search activities"
                aria-label="Search activities"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearch("");
                    setSearching(false);
                  }
                }}
                className="h-[38px] w-full rounded-[2px] border border-[#cad3d6] bg-white pr-10 pl-2.5 text-[14px] text-[#666666] outline-none placeholder:text-[#9ea6aa] focus:border-[#6aa8ee]"
              />
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearch("");
                  setSearching(false);
                }}
                className="absolute top-[7px] right-2 grid size-6 place-items-center rounded-[4px] text-foreground hover:bg-[#f3f6f7]"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
          ) : (
            <>
              <SelectPrimitive.Root value={filter} onValueChange={(v) => onFilterChange(v as TimelineFilter)}>
                <SelectPrimitive.Trigger
                  aria-label="Timeline filter"
                  // 220×44 with Workiz's 3px ink underline; 16px #333 value.
                  className="flex h-11 w-[220px] items-start justify-between border-b-[3px] border-foreground px-2.5 pt-2.5 text-left text-[16px] leading-4 text-[#333333] outline-none"
                >
                  <SelectPrimitive.Value>{filterOptionLabel(filter, counts[filter], hasMore)}</SelectPrimitive.Value>
                  <SelectPrimitive.Icon asChild>
                    <ChevronDown className="size-5 text-[#9ea6aa]" strokeWidth={1.5} />
                  </SelectPrimitive.Icon>
                </SelectPrimitive.Trigger>
                <SelectPrimitive.Portal>
                  <SelectPrimitive.Content
                    position="popper"
                    align="start"
                    sideOffset={8}
                    className="z-50 w-[250px] overflow-hidden rounded-[4px] bg-white py-1 shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)]"
                  >
                    <SelectPrimitive.Viewport>
                      {JOB_TIMELINE_FILTERS.map((f) => (
                        <SelectPrimitive.Item
                          key={f.key}
                          value={f.key}
                          className="flex h-8 cursor-default items-center px-3 text-[14px] leading-4 text-[#404040] outline-none select-none data-highlighted:bg-[#deebff] data-[state=checked]:bg-[#2684ff] data-[state=checked]:text-white"
                        >
                          <SelectPrimitive.ItemText>{filterOptionLabel(f.key, counts[f.key], hasMore)}</SelectPrimitive.ItemText>
                        </SelectPrimitive.Item>
                      ))}
                    </SelectPrimitive.Viewport>
                  </SelectPrimitive.Content>
                </SelectPrimitive.Portal>
              </SelectPrimitive.Root>
              <span className="flex-1" />
              <button
                type="button"
                aria-label="Search the timeline"
                title="Search"
                onClick={() => setSearching(true)}
                className="mt-1.5 grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-[#f3f6f7]"
              >
                <Search className="size-[22px]" strokeWidth={1.25} />
              </button>
            </>
          )}
        </div>

        {/* "Add note / Message Client" — or the note being written. */}
        {composing ? (
          <div className="px-[25px] pt-[14px] pb-6">
            <Textarea
              autoFocus
              aria-label="New note"
              placeholder="Add a note…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-24 min-h-24 resize-y rounded-[4px] border-[#cccccc] px-2.5 py-[7px] text-[14px] text-[#666666] shadow-none"
            />
            <div className="mt-4 flex items-center justify-end gap-6">
              <button
                type="button"
                onClick={() => {
                  setComposing(false);
                  setNote("");
                }}
                className="text-[13px] leading-4 font-semibold text-foreground hover:underline"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!note.trim() || addNote.isPending}
                onClick={submit}
                className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-primary px-4 text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-foreground hover:bg-[#eac300] disabled:bg-[#dfe2e3] disabled:hover:bg-[#dfe2e3]"
              >
                {addNote.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save
              </button>
            </div>
          </div>
        ) : canEdit || onMessageClient ? (
          <div className="px-[30px] pt-[46px] pb-[25px] text-[14px] leading-5 font-medium text-[#404040]">
            {canEdit ? (
              <button type="button" onClick={() => setComposing(true)} className="underline underline-offset-2 hover:text-foreground">
                Add note
              </button>
            ) : null}
            {canEdit && onMessageClient ? <span className="px-2.5">/</span> : null}
            {onMessageClient ? (
              <button type="button" onClick={onMessageClient} className="underline underline-offset-2 hover:text-foreground">
                Message Client
              </button>
            ) : null}
          </div>
        ) : (
          <div className="h-6" />
        )}

        {query.isLoading ? (
          <div className="px-5">
            <Skeleton className="h-48 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-center text-[13px] text-[#404040]">
            {search.trim() ? "Nothing matches your search." : "No activity yet."}
          </p>
        ) : (
          <ol className="pr-5 pl-[23px]">
            {rows.map((row, i) => (
              <JobEntryRow
                key={row.id}
                entry={row}
                lookups={lookups}
                actor={actorLabel(row, userMap)}
                last={i === rows.length - 1}
                canEdit={canEdit}
                isEditing={editingId === row.id}
                onStartEdit={() => setEditingId(row.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={(text) =>
                  updateNote.mutate(
                    { entryId: row.id, timestamp: row.timestamp, note: text },
                    { onSuccess: () => setEditingId(null) },
                  )
                }
                onDelete={() => setDeleting(row)}
              />
            ))}
          </ol>
        )}

        {query.hasNextPage ? (
          <div className="px-5 pb-5">
            <button
              type="button"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="w-full py-2 text-center text-[14px] text-[#6aa8ee] hover:underline disabled:opacity-50"
            >
              {query.isFetchingNextPage ? <Loader2 className="mx-auto size-4 animate-spin" /> : "Load more"}
            </button>
          </div>
        ) : null}
      </div>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.note}&rdquo; will be removed from the job timeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) {
                  deleteNote.mutate({ entryId: deleting.id, timestamp: deleting.timestamp });
                }
                setDeleting(null);
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Workiz draws a note with a pen-in-square; the rest keep their event icon. */
const NOTE_ROW_META = { icon: SquarePen, label: "Note" };

/**
 * One row of the job's Timeline the way Workiz draws it (job_b_03_rail0):
 * a 35px icon on a dotted thread, the actor (14px/500) | "a day ago", then
 * what happened in 12px — three lines and a "More" link. A note gets a ⋮
 * with Edit / Delete for someone who may edit the job.
 */
function JobEntryRow({
  entry,
  lookups,
  actor,
  last,
  canEdit,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  entry: TimelineEntry;
  lookups: Lookups;
  actor: string;
  last: boolean;
  canEdit: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (note: string) => void;
  onDelete: () => void;
}) {
  const meta =
    entry.eventType === TimelineEventType.NOTE_ADDED
      ? NOTE_ROW_META
      : META[entry.eventType] ?? LEGACY_META[entry.eventType] ?? fallbackMeta(entry.eventType);
  const Icon = meta.icon;
  const label = labelOf(entry);
  const d = detail(entry, lookups);
  const changeLines = itemChangeLines(entry);
  const isNote = entry.eventType === TimelineEventType.NOTE_ADDED;
  const [draft, setDraft] = useState(entry.note ?? "");
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const lines = [isNote ? null : label, d, entry.note ? (isNote ? entry.note : `“${entry.note}”`) : null, ...changeLines].filter(
    Boolean,
  ) as string[];
  const long = lines.length > 3 || lines.join(" ").length > 120;

  return (
    <li className="relative flex min-h-[100px] gap-[3px] pb-5">
      {/* The dotted thread from this icon down to the next. */}
      {last ? null : <span aria-hidden className="absolute top-[40px] bottom-0 left-[17px] border-l border-dotted border-[#cad3d6]" />}
      <span className="grid size-[35px] flex-none place-items-center bg-white text-[#404040]">
        <Icon className="size-[21px]" strokeWidth={1.25} />
      </span>
      <div className="min-w-0 flex-1 pt-2.5">
        <div className="flex items-center gap-2 text-[#404040]">
          <span className="max-w-[120px] truncate text-[14px] leading-4 font-medium" title={actor}>
            {actor}
          </span>
          <span aria-hidden className="h-4 border-l border-[#cad3d6]" />
          <span className="text-[12px] leading-4 whitespace-nowrap" title={when(entry.timestamp)}>
            {relativeTime(entry.timestamp)}
          </span>
          <span className="flex-1" />
          {isNote && canEdit && !isEditing ? (
            <span className="relative">
              <button
                type="button"
                aria-label="Note actions"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className="grid size-6 place-items-center rounded-[4px] text-foreground hover:bg-[#f3f6f7]"
              >
                <MoreVertical className="size-4" />
              </button>
              {menuOpen ? (
                <>
                  <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
                  <span role="menu" className="absolute top-full right-0 z-20 mt-1 flex w-36 flex-col rounded-[2px] bg-white py-1 shadow-[0_3px_6px_2px_rgba(0,0,0,0.18),0_4px_15px_2px_rgba(0,0,0,0.15)]">
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Edit note"
                      onClick={() => {
                        setMenuOpen(false);
                        setDraft(entry.note ?? "");
                        onStartEdit();
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-left text-[14px] text-[#566d76] hover:bg-[#f3f6f7]"
                    >
                      <Pencil className="size-4" strokeWidth={1.25} /> Edit
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Delete note"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete();
                      }}
                      className="flex items-center gap-2 border-t border-[#cad3d6] px-3 py-2 text-left text-[14px] text-[#566d76] hover:bg-[#f3f6f7]"
                    >
                      <Trash2 className="size-4" strokeWidth={1.25} /> Delete
                    </button>
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
        </div>

        {isNote && isEditing ? (
          <div className="mt-2 space-y-1.5">
            <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} className="text-[12px]" />
            <div className="flex justify-end gap-4">
              <button type="button" onClick={onCancelEdit} className="text-[13px] font-semibold text-foreground hover:underline">
                Cancel
              </button>
              <button
                type="button"
                aria-label="Save note"
                disabled={!draft.trim()}
                onClick={() => onSaveEdit(draft.trim())}
                className="inline-flex h-7 items-center rounded-pill bg-primary px-3 text-[13px] font-semibold text-foreground hover:bg-[#eac300] disabled:bg-[#dfe2e3]"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Three 16px lines, then "More" (Workiz clips at 48px). */}
            <div className={cn("mt-2 text-[12px] leading-4 text-[#404040]", !expanded && "max-h-12 overflow-hidden")}>
              {lines.map((line, i) => (
                <div key={i} className="wrap-break-word whitespace-pre-line">
                  {line}
                </div>
              ))}
            </div>
            {long ? (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-[14px] leading-4 text-[#6aa8ee] underline">
                {expanded ? "Less" : "More"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * One timeline row: icon, what happened, the note or change lines, when and
 * who. The job page edits notes in place; the client card's History rail
 * reads the same rows across jobs (`job` names which) and leaves editing to
 * the job, so the handlers are optional there.
 */
export function EntryRow({
  entry,
  lookups,
  actor,
  job,
  canEdit = false,
  isEditing = false,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  entry: TimelineEntry;
  lookups: Lookups;
  actor: string;
  /** The job the row belongs to, linked, when the feed spans several. */
  job?: { id: string; number: string };
  canEdit?: boolean;
  isEditing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (note: string) => void;
  onDelete?: () => void;
}) {
  const meta = META[entry.eventType] ?? LEGACY_META[entry.eventType] ?? fallbackMeta(entry.eventType);
  const label = labelOf(entry);
  const Icon = meta.icon;
  const d = detail(entry, lookups);
  const changeLines = itemChangeLines(entry);
  const isNote = entry.eventType === TimelineEventType.NOTE_ADDED;
  const [draft, setDraft] = useState(entry.note ?? "");

  return (
    <li className="group flex gap-3">
      <span className="mt-0.5 grid size-6 flex-none place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-start gap-1">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{label}</span>
            {job ? (
              <span className="text-muted-foreground">
                {" "}· Job:{" "}
                <Link href={`/deals/${job.id}`} className="font-mono font-medium text-brand hover:underline">
                  {job.number}
                </Link>
              </span>
            ) : null}
            {d ? <span className="text-muted-foreground"> · {d}</span> : null}
          </span>
          {isNote && canEdit && !isEditing ? (
            <span className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                aria-label="Edit note"
                onClick={() => {
                  setDraft(entry.note ?? "");
                  onStartEdit?.();
                }}
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3" />
              </button>
              <button
                type="button"
                aria-label="Delete note"
                onClick={onDelete}
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ) : null}
        </div>

        {isNote && isEditing ? (
          <div className="mt-1 space-y-1.5">
            <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7 text-xs" variant="brand" aria-label="Save note" disabled={!draft.trim()} onClick={() => onSaveEdit?.(draft.trim())}>
                Save
              </Button>
              <Button size="sm" className="h-7 text-xs" variant="outline" onClick={onCancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        ) : entry.note ? (
          <div className="text-muted-foreground">“{entry.note}”</div>
        ) : null}

        {changeLines.map((line) => (
          <div key={line} className="text-muted-foreground">{line}</div>
        ))}

        <div className="text-xs text-muted-foreground">
          {when(entry.timestamp)} · {actor}
        </div>
      </div>
    </li>
  );
}
