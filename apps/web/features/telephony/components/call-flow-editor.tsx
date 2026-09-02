"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  Clock,
  KeyRound,
  ListOrdered,
  Loader2,
  MessageSquare,
  Mic,
  MoveDown,
  MoveUp,
  Pencil,
  PhoneCall,
  PhoneOff,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import type { CallFlow, CallFlowNode, CallFlowNodeType } from "@bitcrm/types";
import { useCallGroups } from "../call-groups-hooks";
import { useCallFlows, useSaveCallFlow } from "../call-flows-hooks";
import { useNumbers } from "../numbers-hooks";
import { blankStep, STEP_LABEL } from "../flow-graph";
import {
  deleteStep,
  insertStep,
  newStep,
  reorder,
  replaceStep,
  toGraph,
  toTree,
  type FlowStep,
} from "../flow-tree";
import { layoutFlow, type LayoutNode } from "../flow-layout";
import { FlowCanvas } from "./flow-canvas";
import { FlowStepFields } from "./flow-step-fields";
import { FloatingField, FlowPanel, PanelActions } from "./flow-panel";

/**
 * A new flow opens on something that already works: greet, ring, and take a
 * message when nobody picks up.
 *
 * The voicemail hangs off the ring's no-answer exit rather than sitting after
 * it in the list. A branching step has no main line, so a voicemail drawn
 * below one is a step the call can never reach — it looked configured and
 * never played.
 */
function starter(): FlowStep[] {
  const greeting = blankStep("say");
  const ring = newStep("ring", blankStep("ring"));
  return [
    { node: { ...greeting, type: "say", text: "Thanks for calling." } as CallFlowNode },
    {
      ...ring,
      branches: { ...ring.branches, noAnswer: [{ node: blankStep("voicemail") }] },
    },
  ];
}

/** What the panel is showing, if anything. Only ever one at a time. */
type Panel =
  | { kind: "basic" }
  | { kind: "step"; id: string }
  | { kind: "add"; path: string[]; index: number };

/**
 * The call flow builder.
 *
 * A full-screen canvas with the call drawn on it, and one sheet on the right
 * for everything you can change. The split is deliberate: the picture answers
 * "where does a caller end up", which is the question somebody opens this to
 * answer, and it stops answering it the moment the page is also a form.
 */
export function CallFlowEditor({
  flow,
  open,
  onClose,
}: {
  flow?: CallFlow;
  open: boolean;
  onClose: () => void;
}) {
  const editing = !!flow;

  const [name, setName] = useState(flow?.name ?? "");
  const [numbers, setNumbers] = useState<string[]>(flow?.numbers ?? []);
  const [active, setActive] = useState(flow?.active ?? true);
  const [steps, setSteps] = useState<FlowStep[]>(() =>
    flow ? toTree(flow) : starter(),
  );
  // A flow with no name can't be saved, so a new one opens on the panel that
  // asks for one rather than on a canvas with a disabled Save button.
  const [panel, setPanel] = useState<Panel | undefined>(
    editing ? undefined : { kind: "basic" },
  );

  const { data: groups } = useCallGroups(open);
  const save = useSaveCallFlow(flow?.id);

  // Recomputed rather than tracked: the selected step's position changes when
  // anything above it moves, and a stale copy would move the wrong step.
  const selected =
    panel?.kind === "step"
      ? layoutFlow(steps).nodes.find((n) => n.id === panel.id)
      : undefined;

  const submit = async () => {
    if (!name.trim()) return;
    const { entryNodeId, nodes } = toGraph(steps);
    await save.mutateAsync({ name: name.trim(), numbers, entryNodeId, nodes, active });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 top-0 left-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">
          {editing ? `Edit ${flow.name}` : "New call flow"}
        </DialogTitle>

        <header className="flex flex-none items-center gap-3 border-b px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Back to call flows"
            onClick={onClose}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Workflow className="size-5 text-brand" aria-hidden />
          <span className="h-6 w-px bg-border" aria-hidden />

          <h1 className="truncate text-sm font-semibold tracking-wide uppercase">
            {name.trim() || "New call flow"}
          </h1>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {numbers.length ? numbers.map(formatPhone).join(", ") : "No numbers yet"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Edit the flow's name and numbers"
            onClick={() => setPanel({ kind: "basic" })}
          >
            <Pencil className="size-3.5" />
          </Button>

          <Button
            type="button"
            variant="brand"
            size="lg"
            className="ml-auto gap-1.5 rounded-full px-5"
            disabled={save.isPending || !name.trim()}
            onClick={submit}
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Save call flow" : "Create call flow"}
          </Button>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <FlowCanvas
            steps={steps}
            groups={groups ?? []}
            numbers={numbers}
            selectedId={panel?.kind === "step" ? panel.id : undefined}
            onSelect={(node: LayoutNode) => setPanel({ kind: "step", id: node.id })}
            onSelectEntry={() => setPanel({ kind: "basic" })}
            onAdd={(path, index) => setPanel({ kind: "add", path, index })}
          />

          {panel?.kind === "basic" ? (
            <BasicInfoPanel
              name={name}
              numbers={numbers}
              active={active}
              currentFlowId={flow?.id}
              onApply={(next) => {
                setName(next.name);
                setNumbers(next.numbers);
                setActive(next.active);
                setPanel(undefined);
              }}
              onClose={() => setPanel(undefined)}
            />
          ) : null}

          {panel?.kind === "add" ? (
            <AddStepPanel
              onPick={(type) => {
                setSteps((current) =>
                  insertStep(current, panel.path, panel.index, newStep(type, blankStep(type))),
                );
                setPanel(undefined);
              }}
              onClose={() => setPanel(undefined)}
            />
          ) : null}

          {selected?.step ? (
            <StepPanel
              node={selected}
              groups={groups ?? []}
              onChange={(node) =>
                setSteps((current) =>
                  replaceStep(current, node.id, (step) => ({ ...step, node })),
                )
              }
              onMove={(to) =>
                setSteps((current) => reorder(current, selected.path, selected.index, to))
              }
              onRemove={() => {
                setSteps((current) => deleteStep(current, selected.id));
                setPanel(undefined);
              }}
              onClose={() => setPanel(undefined)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------------- the panels */

/**
 * The flow's own settings: what it's called, which numbers enter it, and
 * whether it is answering calls at all.
 *
 * Edited against a copy so Cancel really cancels — half-changing a name and
 * clicking away should leave the flow as it was.
 */
function BasicInfoPanel({
  name,
  numbers,
  active,
  currentFlowId,
  onApply,
  onClose,
}: {
  name: string;
  numbers: string[];
  active: boolean;
  currentFlowId?: string;
  onApply: (next: { name: string; numbers: string[]; active: boolean }) => void;
  onClose: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftNumbers, setDraftNumbers] = useState(numbers);
  const [draftActive, setDraftActive] = useState(active);

  return (
    <FlowPanel
      title="Basic info"
      onClose={onClose}
      footer={
        <PanelActions
          confirmLabel="Save"
          onCancel={onClose}
          confirmDisabled={!draftName.trim()}
          onConfirm={() =>
            onApply({
              name: draftName,
              numbers: draftNumbers,
              active: draftActive,
            })
          }
        />
      }
    >
      <div className="space-y-5">
        <FloatingField label="Flow name" htmlFor="cf-name">
          <Input
            id="cf-name"
            aria-label="Flow name"
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
            value={draftName}
            placeholder="Main line"
            onChange={(e) => setDraftName(e.target.value)}
            autoFocus
          />
        </FloatingField>

        <NumberField
          selected={draftNumbers}
          currentFlowId={currentFlowId}
          onChange={setDraftNumbers}
        />

        <div className="flex items-start gap-3">
          <Switch
            checked={draftActive}
            onCheckedChange={setDraftActive}
            aria-label="Live"
          />
          <span>
            <span className="block text-sm font-medium">Live</span>
            <span className="block text-xs text-muted-foreground">
              A paused flow answers nothing — its numbers ring everyone online
              instead.
            </span>
          </span>
        </div>
      </div>
    </FlowPanel>
  );
}

/**
 * Which of the workspace's numbers this flow answers.
 *
 * Picked from the numbers actually owned, not typed: a number that isn't ours
 * can never ring, so letting somebody type one only produces a flow that looks
 * configured and never runs. Numbers already spoken for say which flow has
 * them, because that is the question you'd otherwise have to go and answer.
 */
function NumberField({
  selected,
  currentFlowId,
  onChange,
}: {
  selected: string[];
  currentFlowId?: string;
  onChange: (numbers: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: owned, isLoading } = useNumbers(true);
  const { data: flows } = useCallFlows(true);

  const takenBy = (number: string) =>
    (flows ?? []).find(
      (candidate) => candidate.id !== currentFlowId && candidate.numbers.includes(number),
    );

  const toggle = (number: string) =>
    onChange(
      selected.includes(number)
        ? selected.filter((n) => n !== number)
        : [...selected, number],
    );

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5">
        {selected.length ? (
          selected.map((number) => (
            <span
              key={number}
              className="inline-flex items-center gap-1 rounded border bg-muted px-2 py-0.5 text-xs"
            >
              {formatPhone(number)}
              <button
                type="button"
                aria-label={`Stop answering ${formatPhone(number)}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => toggle(number)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        ) : (
          <span className="px-1 text-sm text-muted-foreground">
            No numbers assigned
          </span>
        )}
        <button
          type="button"
          aria-label="Choose numbers"
          aria-expanded={open}
          className="ml-auto text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Select the numbers you want this flow to answer. A number can only be
        answered by one flow.
      </p>

      {open ? (
        isLoading ? (
          <p className="text-xs text-muted-foreground">Loading your numbers…</p>
        ) : !owned || owned.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
            You don&apos;t own any numbers yet.{" "}
            <Link href="/settings/phone-numbers" className="text-brand underline">
              Buy one
            </Link>{" "}
            and it will appear here.
          </p>
        ) : (
          <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border p-1.5">
            {owned.map((number) => {
              const taken = takenBy(number.phoneNumber);
              return (
                <li key={number.sid}>
                  <label
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border p-2 text-sm",
                      taken ? "opacity-60" : "cursor-pointer hover:bg-accent",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(number.phoneNumber)}
                      disabled={!!taken}
                      aria-label={formatPhone(number.phoneNumber)}
                      onChange={() => toggle(number.phoneNumber)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[13px]">
                        {formatPhone(number.phoneNumber)}
                      </span>
                      {number.friendlyName &&
                      number.friendlyName !== number.phoneNumber ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {number.friendlyName}
                        </span>
                      ) : null}
                    </span>
                    {taken ? (
                      <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">
                        answered by {taken.name}
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}

const ICONS: Record<CallFlowNodeType, typeof PhoneCall> = {
  say: MessageSquare,
  hours: Clock,
  menu: ListOrdered,
  ring: PhoneCall,
  voicemail: Mic,
  hangup: PhoneOff,
  ext: KeyRound,
};

// Anything missing here compiles fine and is simply unreachable in the editor
// — the one extension point with no type error to catch it.
const PALETTE: { type: CallFlowNodeType; detail: string }[] = [
  { type: "say", detail: "Play a greeting, typed or recorded." },
  { type: "menu", detail: "“Press 1 for…” — one path per key." },
  { type: "ring", detail: "Ring a call group and connect whoever answers." },
  { type: "hours", detail: "Split the call on your opening times." },
  { type: "voicemail", detail: "Record a message and attach it to the call." },
  { type: "ext", detail: "A technician dials in with a job code." },
  { type: "hangup", detail: "End the call, after a message if you like." },
];

function AddStepPanel({
  onPick,
  onClose,
}: {
  onPick: (type: CallFlowNodeType) => void;
  onClose: () => void;
}) {
  return (
    <FlowPanel title="Add a step" onClose={onClose}>
      <ul className="space-y-2">
        {PALETTE.map(({ type, detail }) => {
          const Icon = ICONS[type];
          return (
            <li key={type}>
              <button
                type="button"
                className="flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:border-brand hover:bg-accent"
                onClick={() => onPick(type)}
              >
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{STEP_LABEL[type]}</span>
                  <span className="block text-xs text-muted-foreground">{detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </FlowPanel>
  );
}

/**
 * One step's settings.
 *
 * Nothing here says where the call goes next: that is the canvas's job, and
 * asking it twice is how the two disagree. Moving a step up or down is the
 * exception — it changes the order, which IS the wiring, and the canvas has
 * nowhere sensible to put that.
 */
function StepPanel({
  node,
  groups,
  onChange,
  onMove,
  onRemove,
  onClose,
}: {
  node: LayoutNode;
  groups: Parameters<typeof FlowStepFields>[0]["groups"];
  onChange: (node: CallFlowNode) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const step = node.step!;
  const label = STEP_LABEL[step.node.type];

  return (
    <FlowPanel
      title={label}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="gap-1.5 text-destructive hover:text-destructive"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <Trash2 className="size-4" /> Remove
          </Button>
          <Button
            type="button"
            variant="brand"
            size="lg"
            className="rounded-full px-6"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {node.canMoveEarlier || node.canMoveLater ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              aria-label={`Move ${label} earlier`}
              disabled={!node.canMoveEarlier}
              onClick={() => onMove(node.index - 1)}
            >
              <MoveUp className="size-3.5" /> Earlier
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              aria-label={`Move ${label} later`}
              disabled={!node.canMoveLater}
              onClick={() => onMove(node.index + 1)}
            >
              <MoveDown className="size-3.5" /> Later
            </Button>
          </div>
        ) : null}

        <FlowStepFields node={step.node} groups={groups} onChange={onChange} />
      </div>
    </FlowPanel>
  );
}
