"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  FilePlus2,
  History,
  Loader2,
  MessageSquare,
  MessagesSquare,
  PackageMinus,
  PackageOpen,
  PackagePlus,
  Pencil,
  Phone,
  PhoneCall,
  PhoneOff,
  Search,
  Sparkles,
  UserMinus,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { formatDuration } from "@/features/calls/lib";
import { stageLabel, superStatusLabel } from "../lib";
import { useAddNote, useDealTimeline } from "../hooks";

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
};

const FIELD_LABEL: Record<string, string> = {
  notes: "Notes",
  internalNotes: "Internal notes",
  scheduledDate: "Scheduled date",
  scheduledTimeSlot: "Time slot",
  serviceArea: "Service area",
  serviceAreaId: "Service area",
  jobTypeId: "Job type",
  sourceId: "Source",
  priority: "Priority",
  poNumber: "PO number",
  workOrderId: "Work order",
  address: "Address",
  tagIds: "Tags",
  paymentStatus: "Payment status",
  assignedTechIds: "Team",
  cancellationReason: "Cancellation reason",
  clientType: "Client type",
};

const fieldLabel = (key: string): string => FIELD_LABEL[key] ?? key;

/** Render a logged value: addresses/arrays flattened, empty as an em-dash. */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(fmtValue).join(", ") : "—";
  if (typeof v === "object") {
    const a = v as Record<string, unknown>;
    if (typeof a.street === "string") {
      return [a.street, a.unit, a.city, a.state, a.zip].filter(Boolean).join(", ");
    }
    return JSON.stringify(v);
  }
  return String(v);
}

/** One-line "what changed, from what to what" for an entry. */
function detail(entry: TimelineEntry): string | null {
  const d = entry.details ?? {};
  if (entry.eventType === TimelineEventType.STATUS_CHANGED) {
    const from = d.fromStatus as string | undefined;
    const to = d.toStatus as string | undefined;
    if (from && to) return `${superStatusLabel(from as never)} → ${superStatusLabel(to as never)}`;
  }
  if (entry.eventType === TimelineEventType.STAGE_CHANGED) {
    const from = d.fromStage as string | undefined;
    const to = d.toStage as string | undefined;
    if (from && to) return `${stageLabel(from as never)} → ${stageLabel(to as never)}`;
  }
  if (entry.eventType === TimelineEventType.FIELD_UPDATED && typeof d.field === "string") {
    const label = fieldLabel(d.field);
    if ("oldValue" in d) return `${label}: ${fmtValue(d.oldValue)} → ${fmtValue(d.newValue)}`;
    // Legacy entries logged only the new value.
    if ("newValue" in d) return `${label} → ${fmtValue(d.newValue)}`;
    return label;
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
  return null;
}

function when(ts: string): string {
  const dt = new Date(ts);
  return Number.isNaN(dt.getTime())
    ? ts
    : dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ----------------------------------------------------- mocked feeds (WIP) */

export type MockTimelineItem = {
  id: string;
  kind: "activity" | "call" | "message";
  title: string;
  description: string;
  actorName: string;
  timestamp: string;
};

/**
 * The activities / calls / messages integrations are still in progress —
 * these placeholder items keep the filters demoable until the real feeds land.
 */
export const MOCK_TIMELINE_ITEMS: MockTimelineItem[] = [
  { id: "mock-act-1", kind: "activity", title: "Estimate approved", description: "Client approved estimate EST-1042", actorName: "System", timestamp: "2026-07-30T14:05:00.000Z" },
  { id: "mock-act-2", kind: "activity", title: "Invoice sent", description: "Invoice INV-208 emailed to the client", actorName: "System", timestamp: "2026-07-29T16:40:00.000Z" },
  { id: "mock-call-1", kind: "call", title: "Outbound call · 4:32", description: "Client confirmed the appointment window", actorName: "Dispatch line", timestamp: "2026-07-30T09:12:00.000Z" },
  { id: "mock-call-2", kind: "call", title: "Missed call", description: "No voicemail left", actorName: "Dispatch line", timestamp: "2026-07-28T18:03:00.000Z" },
  { id: "mock-msg-1", kind: "message", title: "SMS from client", description: "“Great, see you soon.”", actorName: "Client", timestamp: "2026-07-30T08:57:00.000Z" },
  { id: "mock-msg-2", kind: "message", title: "SMS to client", description: "“Technician is 15 minutes away.”", actorName: "Auto-notify", timestamp: "2026-07-30T08:55:00.000Z" },
];

const MOCK_ICON: Record<MockTimelineItem["kind"], typeof Zap> = {
  activity: Zap,
  call: Phone,
  message: MessagesSquare,
};

/* -------------------------------------------------------------- filters */

type TimelineFilter = "all" | "notes" | "activities" | "calls" | "messages";

const FILTERS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notes", label: "Notes" },
  { key: "activities", label: "Activities" },
  { key: "calls", label: "Calls" },
  { key: "messages", label: "Messages" },
];

const MOCK_KIND_FOR_FILTER: Partial<Record<TimelineFilter, MockTimelineItem["kind"]>> = {
  activities: "activity",
  calls: "call",
  messages: "message",
};

type Row =
  | { type: "entry"; ts: string; entry: TimelineEntry }
  | { type: "mock"; ts: string; mock: MockTimelineItem };

function entryHaystack(entry: TimelineEntry): string {
  const meta = META[entry.eventType];
  return [meta?.label ?? entry.eventType, detail(entry), entry.note, entry.actorName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function mockHaystack(mock: MockTimelineItem): string {
  return [mock.title, mock.description, mock.actorName].join(" ").toLowerCase();
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
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [search, setSearch] = useState("");

  const entries = useMemo(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );

  const rows = useMemo<Row[]>(() => {
    let base: Row[];
    if (filter === "all") {
      base = [
        ...entries.map<Row>((entry) => ({ type: "entry", ts: entry.timestamp, entry })),
        ...MOCK_TIMELINE_ITEMS.map<Row>((mock) => ({ type: "mock", ts: mock.timestamp, mock })),
      ];
    } else if (filter === "notes") {
      base = entries
        .filter((e) => e.eventType === TimelineEventType.NOTE_ADDED)
        .map<Row>((entry) => ({ type: "entry", ts: entry.timestamp, entry }));
    } else {
      const kind = MOCK_KIND_FOR_FILTER[filter];
      base = MOCK_TIMELINE_ITEMS.filter((m) => m.kind === kind).map<Row>((mock) => ({
        type: "mock",
        ts: mock.timestamp,
        mock,
      }));
    }

    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((row) =>
        (row.type === "entry" ? entryHaystack(row.entry) : mockHaystack(row.mock)).includes(q),
      );
    }

    return base.sort((a, b) => b.ts.localeCompare(a.ts));
  }, [entries, filter, search]);

  const submit = () => {
    const v = note.trim();
    if (!v) return;
    addNote.mutate(v, { onSuccess: () => setNote("") });
  };

  const mockFilterLabel = FILTERS.find((f) => f.key === filter)?.label;

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
        {MOCK_KIND_FOR_FILTER[filter] ? (
          <p className="rounded-lg border border-dashed bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {mockFilterLabel} integration is in progress — showing demo data.
          </p>
        ) : null}

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
            {rows.map((row) =>
              row.type === "entry" ? (
                <EntryRow key={row.entry.id} entry={row.entry} />
              ) : (
                <MockRow key={row.mock.id} mock={row.mock} />
              ),
            )}
          </ol>
        )}

        {query.hasNextPage && (filter === "all" || filter === "notes") ? (
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
    </>
  );
}

function EntryRow({ entry }: { entry: TimelineEntry }) {
  const meta = META[entry.eventType] ?? { icon: Sparkles, label: entry.eventType };
  const Icon = meta.icon;
  const d = detail(entry);
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-6 flex-none place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{meta.label}</span>
        {d ? <span className="text-muted-foreground"> · {d}</span> : null}
        {entry.note ? <div className="text-muted-foreground">“{entry.note}”</div> : null}
        <div className="text-xs text-muted-foreground">
          {when(entry.timestamp)} · {entry.actorName}
        </div>
      </div>
    </li>
  );
}

function MockRow({ mock }: { mock: MockTimelineItem }) {
  const Icon = MOCK_ICON[mock.kind];
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-6 flex-none place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{mock.title}</span>
        <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
          Demo
        </span>
        <div className="text-muted-foreground">{mock.description}</div>
        <div className="text-xs text-muted-foreground">
          {when(mock.timestamp)} · {mock.actorName}
        </div>
      </div>
    </li>
  );
}
