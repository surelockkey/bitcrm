"use client";

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  Clock,
  GripVertical,
  ListOrdered,
  MessageSquare,
  Mic,
  PhoneCall,
  PhoneOff,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CallFlowNode, CallFlowNodeType, CallGroupWithMembers } from "@bitcrm/types";
import {
  branchKeysOf,
  isBranching,
  type FlowStep,
} from "../flow-tree";
import { STEP_LABEL } from "../flow-graph";
import { FlowStepFields } from "./flow-step-fields";

const ICONS: Record<CallFlowNodeType, typeof PhoneCall> = {
  say: MessageSquare,
  hours: Clock,
  menu: ListOrdered,
  ring: PhoneCall,
  voicemail: Mic,
  hangup: PhoneOff,
};

/** The one-line summary shown when a step is collapsed. */
function summarise(node: CallFlowNode, groupName: (id: string) => string): string {
  switch (node.type) {
    case "say":
      return node.audioId ? "Plays a recording" : node.text || "Says nothing yet";
    case "hours": {
      const days = node.windows.length;
      return `${days} day${days === 1 ? "" : "s"} a week · ${node.timezone}`;
    }
    case "menu":
      return `${node.options.length} option${node.options.length === 1 ? "" : "s"}`;
    case "ring":
      return node.groupId ? groupName(node.groupId) : "No group picked yet";
    case "voicemail":
      return `Records up to ${node.maxSeconds}s`;
    case "hangup":
      return node.text || "Ends the call";
  }
}

/**
 * The flow, drawn as the call happens: top to bottom, branches nested under
 * the step that creates them.
 *
 * Order is the wiring — dragging a step moves it in the call — so there is no
 * "and then go to…" anywhere. That single decision is what makes this legible
 * to somebody who has never seen a flowchart tool.
 */
export function FlowCanvas({
  steps,
  groups,
  onReorder,
  onChange,
  onDelete,
  onAdd,
}: {
  steps: FlowStep[];
  groups: CallGroupWithMembers[];
  /** Move within one sequence, addressed by branch path. */
  onReorder: (path: string[], from: number, to: number) => void;
  onChange: (node: CallFlowNode) => void;
  onDelete: (id: string) => void;
  onAdd: (path: string[], type: CallFlowNodeType) => void;
}) {
  return (
    <Sequence
      steps={steps}
      path={[]}
      groups={groups}
      onReorder={onReorder}
      onChange={onChange}
      onDelete={onDelete}
      onAdd={onAdd}
    />
  );
}

function Sequence({
  steps,
  path,
  groups,
  onReorder,
  onChange,
  onDelete,
  onAdd,
}: {
  steps: FlowStep[];
  path: string[];
  groups: CallGroupWithMembers[];
  onReorder: (path: string[], from: number, to: number) => void;
  onChange: (node: CallFlowNode) => void;
  onDelete: (id: string) => void;
  onAdd: (path: string[], type: CallFlowNodeType) => void;
}) {
  // A small drag threshold, so clicking a card to expand it isn't read as a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = steps.findIndex((s) => s.node.id === active.id);
    const to = steps.findIndex((s) => s.node.id === over.id);
    if (from >= 0 && to >= 0) onReorder(path, from, to);
  };

  return (
    <div className="space-y-0">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={steps.map((s) => s.node.id)}
          strategy={verticalListSortingStrategy}
        >
          {steps.map((step, index) => (
            <div key={step.node.id}>
              <StepCard
                step={step}
                groups={groups}
                draggable={steps.length > 1}
                onChange={onChange}
                onDelete={onDelete}
              />
              {/* The connector to whatever comes next — the line that makes
                  this read as a flow rather than a list of settings. */}
              {index < steps.length - 1 ? <Connector /> : null}

              {step.branches ? (
                <div className="mt-1 space-y-3 pl-5">
                  {branchKeysOf(step.node).map(({ key, label }) => (
                    <div key={key} className="relative">
                      <span className="absolute -left-5 top-3 h-px w-4 bg-border" />
                      <span className="absolute -left-5 top-0 h-3 w-px bg-border" />
                      <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                        {label}
                      </div>
                      <Sequence
                        steps={step.branches?.[key] ?? []}
                        path={[...path, step.node.id, key]}
                        groups={groups}
                        onReorder={onReorder}
                        onChange={onChange}
                        onDelete={onDelete}
                        onAdd={onAdd}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </SortableContext>
      </DndContext>

      <AddStep path={path} onAdd={onAdd} dense={path.length > 0} />
    </div>
  );
}

function Connector() {
  return (
    <div className="flex justify-center py-1" aria-hidden>
      <span className="h-4 w-px bg-border" />
    </div>
  );
}

function StepCard({
  step,
  groups,
  draggable,
  onChange,
  onDelete,
}: {
  step: FlowStep;
  groups: CallGroupWithMembers[];
  draggable: boolean;
  onChange: (node: CallFlowNode) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: step.node.id });
  const Icon = ICONS[step.node.type];
  const groupName = (id: string) =>
    groups.find((g) => g.id === id)?.name ?? "a deleted group";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border bg-card shadow-sm",
        isDragging && "z-10 opacity-80 shadow-md",
      )}
    >
      <div className="flex items-center gap-2 p-2.5">
        {draggable ? (
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
            aria-label={`Reorder ${STEP_LABEL[step.node.type]}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon className="size-3.5" />
        </span>

        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
          // Named apart from this card's Reorder and Remove, which carry the
          // same step label.
          aria-label={`Edit ${STEP_LABEL[step.node.type]}`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="block text-sm font-medium">
            {STEP_LABEL[step.node.type]}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {summarise(step.node, groupName)}
          </span>
        </button>

        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${STEP_LABEL[step.node.type]}`}
          onClick={() => onDelete(step.node.id)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {open ? (
        <div className="border-t p-3">
          <FlowStepFields node={step.node} groups={groups} onChange={onChange} />
          {isBranching(step.node.type) ? (
            <p className="mt-2 text-xs text-muted-foreground">
              What happens down each path is set below, under its label.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const PALETTE: CallFlowNodeType[] = [
  "say",
  "menu",
  "ring",
  "hours",
  "voicemail",
  "hangup",
];

function AddStep({
  path,
  onAdd,
  dense,
}: {
  path: string[];
  onAdd: (path: string[], type: CallFlowNodeType) => void;
  dense: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className={cn("flex justify-center", dense ? "pt-1.5" : "pt-2")}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-full border-dashed text-xs"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-3" /> Add a step
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-dashed p-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {PALETTE.map((type) => {
          const Icon = ICONS[type];
          return (
            <button
              key={type}
              type="button"
              className="flex items-center gap-2 rounded-lg border p-2 text-left text-xs hover:bg-accent"
              onClick={() => {
                onAdd(path, type);
                setOpen(false);
              }}
            >
              <Icon className="size-3.5 shrink-0 text-brand" />
              {STEP_LABEL[type]}
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 h-6 w-full text-xs text-muted-foreground"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
