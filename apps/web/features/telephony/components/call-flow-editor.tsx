"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  Clock,
  KeyRound,
  ListOrdered,
  MessageSquare,
  Mic,
  MoveDown,
  MoveUp,
  PhoneCall,
  PhoneOff,
  Workflow,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WzButton } from "@/components/workiz/button";
import { WzEditIcon, WzTrashIcon } from "@/components/workiz/icons";
import { WzSwitch } from "@/components/workiz/toggles";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import type { CallDevice, CallFlow, CallFlowNode, CallFlowNodeType, RingNode } from "@bitcrm/types";
import { useCallGroups, useTeammates } from "../call-groups-hooks";
import { useCallDevices } from "../call-devices-hooks";
import { useCallFlows, useSaveCallFlow } from "../call-flows-hooks";
import { useNumbers } from "../numbers-hooks";
import type { TransferTarget } from "../api";
import { BusinessProfileSelect } from "@/features/business-profiles/components/business-profile-select";
import { blankStep, ringTargetLabel, STEP_LABEL } from "../flow-graph";
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
  // Workiz's "Record Call Flow": on unless the flow says otherwise — a flow
  // from before the switch recorded, and still does.
  const [record, setRecord] = useState(flow?.record ?? true);
  const [businessProfileId, setBusinessProfileId] = useState<string | null>(
    flow?.businessProfileId ?? null,
  );
  const [steps, setSteps] = useState<FlowStep[]>(() =>
    flow ? toTree(flow) : starter(),
  );
  // A flow with no name can't be saved, so a new one opens on the panel that
  // asks for one rather than on a canvas with a disabled Save button.
  const [panel, setPanel] = useState<Panel | undefined>(
    editing ? undefined : { kind: "basic" },
  );

  const { data: groups } = useCallGroups(open);
  // The Forward step's User and Device tabs; absent on an API from before
  // devices, in which case the tabs simply offer nobody.
  const { data: teammates } = useTeammates(open);
  const { data: devices } = useCallDevices(open);
  const save = useSaveCallFlow(flow?.id);

  const targetLabel = (node: RingNode) =>
    ringTargetLabel(node, {
      group: (id) => (groups ?? []).find((g) => g.id === id)?.name,
      user: (id) => (teammates ?? []).find((u) => u.id === id)?.name,
      device: (id) => (devices ?? []).find((d) => d.id === id)?.name,
    });

  // Recomputed rather than tracked: the selected step's position changes when
  // anything above it moves, and a stale copy would move the wrong step.
  const selected =
    panel?.kind === "step"
      ? layoutFlow(steps).nodes.find((n) => n.id === panel.id)
      : undefined;

  const submit = async () => {
    if (!name.trim()) return;
    const { entryNodeId, nodes } = toGraph(steps);
    await save.mutateAsync({
      name: name.trim(),
      numbers,
      entryNodeId,
      nodes,
      active,
      businessProfileId,
      record,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div data-slot="call-flow-builder" className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        {/* Workiz's FlowHeader (pg_settings_phone_wz_builder_canvas): ← in a
            22px ink ring (the builder's own way back — an in-page state, so it
            keeps it), the logo slot, a 2×30 rule, the name 16px/19px, the
            numbers 11px, ✎, then the yellow "Save Call Flow" right after. */}
        <header className="flex h-[92px] flex-none items-center gap-0 pr-6 pl-[45px]">
          <button
            type="button"
            aria-label="Back to call flows"
            onClick={onClose}
            className="grid size-[22px] shrink-0 cursor-pointer place-items-center rounded-full border border-foreground text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus"
          >
            <ArrowLeft className="size-3" strokeWidth={2} />
          </button>
          <Workflow className="ml-[25px] size-[26px] shrink-0 text-foreground" strokeWidth={2.25} aria-hidden />
          <span className="mx-5 h-[30px] w-0.5 shrink-0 bg-[rgba(59,76,83,0.3)]" aria-hidden />

          <h1 className="min-w-0 truncate text-base leading-[19px] font-normal tracking-[0.4px] text-[#3b4c53]">
            {name.trim() || "New call flow"}
          </h1>
          <span className="ml-3 hidden min-w-0 truncate text-[11px] leading-4 tracking-[0.4px] text-[rgba(59,76,83,0.7)] sm:inline">
            {numbers.length ? numbers.map(formatPhone).join(", ") : "No numbers yet"}
          </span>
          <button
            type="button"
            aria-label="Edit the flow's name and numbers"
            onClick={() => setPanel({ kind: "basic" })}
            className="ml-3 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[4px] text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus"
          >
            <WzEditIcon size={18} />
          </button>

          <WzButton
            size="regular"
            className="ml-[35px] min-w-[150px]"
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={submit}
          >
            {editing ? "Save Call Flow" : "Create Call Flow"}
          </WzButton>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <FlowCanvas
            steps={steps}
            targetLabel={targetLabel}
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
              record={record}
              businessProfileId={businessProfileId}
              currentFlowId={flow?.id}
              onApply={(next) => {
                setName(next.name);
                setNumbers(next.numbers);
                setActive(next.active);
                setRecord(next.record);
                setBusinessProfileId(next.businessProfileId);
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
              teammates={teammates ?? []}
              devices={devices ?? []}
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
    </div>
  );
}

/* --------------------------------------------------------------- the panels */

/**
 * The flow's own settings: what it's called, which numbers enter it, whether
 * its calls are recorded, and whether it is answering calls at all.
 *
 * Edited against a copy so Cancel really cancels — half-changing a name and
 * clicking away should leave the flow as it was.
 */
function BasicInfoPanel({
  name,
  numbers,
  active,
  record,
  businessProfileId,
  currentFlowId,
  onApply,
  onClose,
}: {
  name: string;
  numbers: string[];
  active: boolean;
  record: boolean;
  businessProfileId: string | null;
  currentFlowId?: string;
  onApply: (next: {
    name: string;
    numbers: string[];
    active: boolean;
    record: boolean;
    businessProfileId: string | null;
  }) => void;
  onClose: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftNumbers, setDraftNumbers] = useState(numbers);
  const [draftActive, setDraftActive] = useState(active);
  const [draftRecord, setDraftRecord] = useState(record);
  const [draftCompany, setDraftCompany] = useState(businessProfileId);

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
              record: draftRecord,
              businessProfileId: draftCompany,
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
            className="h-6 rounded-none border-0 bg-transparent px-0 text-base leading-4 text-wz-text shadow-none hover:border-0 focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0"
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

        {/* Workiz's "Record Call Flow" (pg_settings_phone_wz_builder_basic):
            the 40×20 green toggle, the 13px/600 title 10px after it, and
            "Record and save calls in this call flow" 13px under them —
            the row 31px under the numbers' hint, the words 28px under the title. */}
        <div className="pt-[11px]">
          <div className="flex items-center gap-2.5">
            <WzSwitch
              aria-label="Record Call Flow"
              checked={draftRecord}
              onCheckedChange={setDraftRecord}
            />
            <span className="text-[13px] leading-4 font-semibold tracking-[0.4px] text-[#3b4c53]">Record Call Flow</span>
          </div>
          <p className="mt-[10px] text-[13px] leading-4 tracking-[0.4px] text-[rgba(59,76,83,0.8)]">
            Record and save calls in this call flow
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="cf-company" className="block text-[13px] leading-4 font-semibold tracking-[0.4px] text-[#3b4c53]">
            Company
          </label>
          <BusinessProfileSelect
            id="cf-company"
            value={draftCompany}
            onChange={setDraftCompany}
            allowNone
            noneLabel="Default company"
            placeholder="Default company"
          />
          <p className="text-[11px] leading-4 tracking-[0.4px] text-[rgba(59,76,83,0.8)]">
            Jobs created from calls on this flow&apos;s numbers are pre-filled with this company
          </p>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            checked={draftActive}
            onCheckedChange={setDraftActive}
            aria-label="Live"
          />
          <span>
            <span className="block text-[13px] leading-4 font-semibold tracking-[0.4px] text-[#3b4c53]">Live</span>
            <span className="mt-3 block text-[13px] leading-4 tracking-[0.4px] text-[rgba(59,76,83,0.8)]">
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
      <div className="flex min-h-[49px] flex-wrap items-center gap-1.5 rounded-[4px] border border-input bg-white px-2.5 py-1.5">
        {selected.length ? (
          selected.map((number) => (
            <span
              key={number}
              className="inline-flex items-center gap-1 rounded-[2px] border border-input bg-white py-[3px] pr-1 pl-1.5 text-[11.9px] leading-4 text-wz-value"
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
          <span className="px-1 text-sm text-wz-placeholder">
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
      <p className="text-[11px] leading-4 tracking-[0.4px] text-[rgba(59,76,83,0.8)]">
        Select the numbers you want this flow to answer. A number can only be
        answered by one flow.
      </p>

      {open ? (
        isLoading ? (
          <p className="text-xs text-muted-foreground">Loading your numbers…</p>
        ) : !owned || owned.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
            You don&apos;t own any numbers yet.{" "}
            <Link href="/calls/numbers" className="text-brand underline">
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
                      <span className="rounded-chip border px-1.5 text-[10px] text-muted-foreground">
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
  { type: "ring", detail: "Forward the call to a group, a user, a device or an outside number." },
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
  // Workiz's "Choose the next step" (pg_settings_phone_wz_builder_add_open):
  // full-width rows under 1px rules — a 24px glyph 20px in, the 13px/600
  // title 48px past it, 13px words under it.
  return (
    <FlowPanel title="Choose the next step" onClose={onClose} bodyClassName="p-0">
      <ul>
        {PALETTE.map(({ type, detail }) => {
          const Icon = ICONS[type];
          return (
            <li key={type} className="border-b border-[#e8e8e8]">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-6 py-5 pr-5 pl-5 text-left outline-none hover:bg-wz-secondary-hover focus-visible:bg-wz-secondary-hover"
                onClick={() => onPick(type)}
              >
                <Icon className="size-6 shrink-0 text-foreground" strokeWidth={1.25} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-foreground">
                    {STEP_LABEL[type]}
                  </span>
                  <span className="mt-1.5 block text-[13px] leading-4 tracking-[0.4px] text-wz-slate">{detail}</span>
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
  teammates,
  devices,
  onChange,
  onMove,
  onRemove,
  onClose,
}: {
  node: LayoutNode;
  groups: Parameters<typeof FlowStepFields>[0]["groups"];
  teammates: TransferTarget[];
  devices: CallDevice[];
  onChange: (node: CallFlowNode) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const step = node.step!;
  // Workiz titles the Forward pane "Forward Calls".
  const label = step.node.type === "ring" ? "Forward Calls" : STEP_LABEL[step.node.type];

  return (
    <FlowPanel
      title={label}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-4">
          <WzButton
            variant="secondary"
            size="regular"
            className="h-[35px] flex-1"
            icon={<WzTrashIcon />}
            aria-label={`Remove ${STEP_LABEL[step.node.type]}`}
            onClick={onRemove}
          >
            Remove
          </WzButton>
          <WzButton size="regular" className="h-[35px] flex-1" onClick={onClose}>
            Done
          </WzButton>
        </div>
      }
    >
      <div className="space-y-4">
        {node.canMoveEarlier || node.canMoveLater ? (
          <div className="flex items-center gap-2">
            <WzButton
              variant="secondary"
              size="regular"
              icon={<MoveUp />}
              aria-label={`Move ${STEP_LABEL[step.node.type]} earlier`}
              disabled={!node.canMoveEarlier}
              onClick={() => onMove(node.index - 1)}
            >
              Earlier
            </WzButton>
            <WzButton
              variant="secondary"
              size="regular"
              icon={<MoveDown />}
              aria-label={`Move ${STEP_LABEL[step.node.type]} later`}
              disabled={!node.canMoveLater}
              onClick={() => onMove(node.index + 1)}
            >
              Later
            </WzButton>
          </div>
        ) : null}

        <FlowStepFields node={step.node} groups={groups} teammates={teammates} devices={devices} onChange={onChange} />
      </div>
    </FlowPanel>
  );
}
