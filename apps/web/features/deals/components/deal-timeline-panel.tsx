"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  FilePlus2,
  FileX,
  History,
  Loader2,
  MessageSquare,
  PackageMinus,
  PackageOpen,
  PackagePlus,
  Paperclip,
  Pencil,
  PhoneCall,
  PhoneOff,
  Search,
  Sparkles,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatDuration } from "@/features/calls/lib";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useExternalCompanies } from "@/features/external-companies/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { stageLabel, superStatusLabel } from "../lib";
import {
  useAddNote,
  useContactMap,
  useDealTimeline,
  useDeleteNote,
  useUpdateNote,
  useUserMap,
} from "../hooks";

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
  [TimelineEventType.ATTACHMENT_ADDED]: { icon: Paperclip, label: "File added" },
  [TimelineEventType.ATTACHMENT_RENAMED]: { icon: Paperclip, label: "File renamed" },
  [TimelineEventType.ATTACHMENT_REMOVED]: { icon: FileX, label: "File removed" },
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
};

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
interface Lookups {
  userName: (id: unknown) => string | null;
  contactName: (id: unknown) => string | null;
  jobTypes: Map<string, string>;
  sources: Map<string, string>;
  externalCompanies: Map<string, string>;
  subStatuses: Map<string, string>;
  tags: Map<string, string>;
}

function useTimelineLookups(): Lookups {
  const { map: userMap } = useUserMap();
  const { map: contactMap } = useContactMap();
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

/** Render a logged value: addresses/arrays flattened, empty as an em-dash. */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
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
  return null;
}

function when(ts: string): string {
  const dt = new Date(ts);
  return Number.isNaN(dt.getTime())
    ? ts
    : dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* -------------------------------------------------------------- filters */

type TimelineFilter = "all" | "notes" | "activities" | "calls";

const FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notes", label: "Notes" },
  { key: "activities", label: "Activities" },
  { key: "calls", label: "Calls" },
];

const CALL_EVENTS = new Set([TimelineEventType.CALL_LINKED, TimelineEventType.CALL_UNLINKED]);

function matchesFilter(entry: TimelineEntry, filter: TimelineFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "notes":
      return entry.eventType === TimelineEventType.NOTE_ADDED;
    case "calls":
      return CALL_EVENTS.has(entry.eventType);
    case "activities":
      // Everything the system recorded that isn't a note or a call.
      return entry.eventType !== TimelineEventType.NOTE_ADDED && !CALL_EVENTS.has(entry.eventType);
  }
}

function entryHaystack(entry: TimelineEntry, lk: Lookups): string {
  const meta = META[entry.eventType];
  return [meta?.label ?? entry.eventType, detail(entry, lk), entry.note, entry.actorName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/* ---------------------------------------------------------------- panel */

/**
 * Workiz-style job history: a handle hanging on the right edge of the job
 * page; clicking it slides out the timeline with the full change log
 * (who changed what, from what to what), filters and search.
 */
export function DealTimelinePanel({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  // The body (and its timeline query) mounts on first open and then stays
  // mounted, so the slide animation has something to slide and the chosen
  // filter/search survive a close–reopen round trip.
  const [hasOpened, setHasOpened] = useState(false);

  const toggle = () => {
    setOpen((o) => !o);
    setHasOpened(true);
  };

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "fixed top-44 z-40 flex flex-col items-center gap-1.5 rounded-l-xl bg-brand px-2 py-2.5 text-brand-foreground shadow-lg transition-[right] duration-300 ease-in-out hover:bg-brand/90",
          open ? "right-95 max-[447px]:right-[85vw]" : "right-0",
        )}
      >
        <History className="size-4.5" />
        <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">
          Timeline
        </span>
      </button>
      <aside
        aria-label="Job timeline"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-95 max-w-[85vw] flex-col border-l bg-background shadow-xl transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {hasOpened ? (
          <PanelBody dealId={dealId} canEdit={canEdit} onClose={() => setOpen(false)} />
        ) : null}
      </aside>
    </>
  );
}

function PanelBody({
  dealId,
  canEdit,
  onClose,
}: {
  dealId: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const query = useDealTimeline(dealId);
  const addNote = useAddNote(dealId);
  const updateNote = useUpdateNote(dealId);
  const deleteNote = useDeleteNote(dealId);
  const { map: userMap } = useUserMap();
  const lookups = useTimelineLookups();
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TimelineEntry | null>(null);

  // Entries store the actor's email; show the person's name when we know them
  // (system actors like "Payment Service" fall back to the stored label).
  const actorLabel = (e: TimelineEntry) => {
    const u = userMap.get(e.actorId);
    const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
    return name || e.actorName;
  };

  const entries = useMemo(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );

  const rows = useMemo(() => {
    let base = entries.filter((e) => matchesFilter(e, filter));
    const q = search.trim().toLowerCase();
    if (q) base = base.filter((e) => entryHaystack(e, lookups).includes(q));
    return [...base].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [entries, filter, search, lookups]);

  const submit = () => {
    const v = note.trim();
    if (!v) return;
    addNote.mutate(v, { onSuccess: () => setNote("") });
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <History className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Timeline</span>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close timeline">
          <X className="size-4" />
        </Button>
      </div>

      {/* Search + filters */}
      <div className="space-y-2 border-b px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            placeholder="Search timeline…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {canEdit && (filter === "all" || filter === "notes") ? (
          <div className="flex items-center gap-2">
            <Input
              className="h-9"
              placeholder="Add a note…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!note.trim() || addNote.isPending}
              onClick={submit}
            >
              {addNote.isPending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />} Add
            </Button>
          </div>
        ) : null}

        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {search.trim() ? "Nothing matches your search." : "No activity yet."}
          </p>
        ) : (
          <ol className="space-y-3">
            {rows.map((row) => (
              <EntryRow
                key={row.id}
                entry={row}
                lookups={lookups}
                actor={actorLabel(row)}
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
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
          </Button>
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

function EntryRow({
  entry,
  lookups,
  actor,
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
  canEdit: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (note: string) => void;
  onDelete: () => void;
}) {
  const meta = META[entry.eventType] ?? { icon: Sparkles, label: entry.eventType };
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
            <span className="font-medium">{meta.label}</span>
            {d ? <span className="text-muted-foreground"> · {d}</span> : null}
          </span>
          {isNote && canEdit && !isEditing ? (
            <span className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                aria-label="Edit note"
                onClick={() => {
                  setDraft(entry.note ?? "");
                  onStartEdit();
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
              <Button size="sm" className="h-7 text-xs" variant="brand" aria-label="Save note" disabled={!draft.trim()} onClick={() => onSaveEdit(draft.trim())}>
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
