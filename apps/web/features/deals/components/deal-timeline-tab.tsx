"use client";

import { useState } from "react";
import {
  ArrowRight,
  FilePlus2,
  Loader2,
  MessageSquare,
  PackageMinus,
  PackagePlus,
  Pencil,
  Sparkles,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { stageLabel } from "../lib";
import { useAddNote, useDealTimeline } from "../hooks";

const META: Record<TimelineEventType, { icon: typeof Sparkles; label: string }> = {
  [TimelineEventType.CREATED]: { icon: Sparkles, label: "Deal created" },
  [TimelineEventType.STAGE_CHANGED]: { icon: ArrowRight, label: "Stage changed" },
  [TimelineEventType.FIELD_UPDATED]: { icon: Pencil, label: "Field updated" },
  [TimelineEventType.NOTE_ADDED]: { icon: MessageSquare, label: "Note" },
  [TimelineEventType.TECH_ASSIGNED]: { icon: UserPlus, label: "Technician assigned" },
  [TimelineEventType.TECH_UNASSIGNED]: { icon: UserMinus, label: "Technician unassigned" },
  [TimelineEventType.PRODUCT_ADDED]: { icon: PackagePlus, label: "Product added" },
  [TimelineEventType.PRODUCT_REMOVED]: { icon: PackageMinus, label: "Product removed" },
};

function detail(entry: TimelineEntry): string | null {
  const d = entry.details ?? {};
  if (entry.eventType === TimelineEventType.STAGE_CHANGED) {
    const from = d.fromStage as string | undefined;
    const to = d.toStage as string | undefined;
    if (from && to) return `${stageLabel(from as never)} → ${stageLabel(to as never)}`;
  }
  if (entry.eventType === TimelineEventType.FIELD_UPDATED && typeof d.field === "string") return d.field;
  if (
    (entry.eventType === TimelineEventType.PRODUCT_ADDED || entry.eventType === TimelineEventType.PRODUCT_REMOVED) &&
    typeof d.name === "string"
  ) {
    return d.qty ? `${d.name} ×${d.qty}` : (d.name as string);
  }
  return null;
}

function when(ts: string): string {
  const dt = new Date(ts);
  return Number.isNaN(dt.getTime())
    ? ts
    : dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function DealTimelineTab({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const query = useDealTimeline(dealId);
  const addNote = useAddNote(dealId);
  const [note, setNote] = useState("");

  const entries = query.data?.pages.flatMap((p) => p.data) ?? [];

  const submit = () => {
    const v = note.trim();
    if (!v) return;
    addNote.mutate(v, { onSuccess: () => setNote("") });
  };

  if (query.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Input
            className="h-9"
            placeholder="Add a note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!note.trim() || addNote.isPending} onClick={submit}>
            {addNote.isPending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />} Add
          </Button>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => {
            const meta = META[e.eventType] ?? { icon: Sparkles, label: e.eventType };
            const Icon = meta.icon;
            const d = detail(e);
            return (
              <li key={e.id} className="flex gap-3">
                <span className="mt-0.5 grid size-6 flex-none place-items-center rounded-full bg-muted text-muted-foreground">
                  <Icon className="size-3" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{meta.label}</span>
                  {d ? <span className="text-muted-foreground"> · {d}</span> : null}
                  {e.note ? <div className="text-muted-foreground">“{e.note}”</div> : null}
                  <div className="text-xs text-muted-foreground">{when(e.timestamp)} · {e.actorName}</div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {query.hasNextPage ? (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
