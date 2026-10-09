"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, History, Info, Pencil, Plus, X } from "lucide-react";
import type { AutomationLabelMap, AutomationRule, AutomationSpec } from "@bitcrm/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { WzButton } from "@/components/workiz/button";
import { WzDotsMenu } from "@/components/workiz/dots-menu";
import { cn } from "@/lib/utils";
import { useCreateAutomation, useUpdateAutomation } from "../hooks";
import { specSentence } from "../lib";
import { automationFormSchema, specToForm } from "../schemas";
import { AutomationRunsDialog } from "../components/automation-runs-dialog";
import { AutomationTestDialog } from "../components/automation-test-dialog";
import { AddStepButton } from "./add-step-menu";
import { DeliveryWindowControl, type DeliveryWindowValue } from "./delivery-window";
import { AutomationNodeCard, isBigLine, type StepPosition } from "./node-card";
import { NodePanel } from "./node-panel";
import { KIND_LABEL, nodeIssue } from "./node-summary";
import { chainToSpec, isActionNode, newChainNode, nextNodeId, specToChain, type ChainNode } from "./types";

/** What a new rule starts from — a library recipe, or nothing at all. */
export interface AutomationDraft {
  /**
   * The recipe this draft came from (`templates.ts`), so the page can key the
   * builder by it. A draft is not a rule and has no id of its own, and the
   * builder reads its draft into chain state once, as it mounts.
   */
  id?: string;
  name: string;
  spec: AutomationSpec;
  category?: string;
}

/** `AutomationSpecDto.actions` is `@ArrayMaxSize(10)` — said here, not left to a 400. */
const MAX_SPEC_ACTIONS = 10;

/**
 * What keeps this rule from being saved, in the words of the step that can
 * answer it. The steps are asked first and in order, so the reason names the
 * card a reader can go and fix; the schema is asked last, for the things no
 * single step owns — the name, the delivery window, how many actions a spec
 * may hold.
 */
function saveProblem(name: string, nodes: ChainNode[], spec: AutomationSpec): string | undefined {
  if (!name.trim()) return "Name is required";

  for (const [i, node] of nodes.entries()) {
    const issue = nodeIssue(node, nodes);
    if (issue?.level === "blocks") return `Step ${i + 1}, ${KIND_LABEL[node.kind]}: ${issue.text}`;
  }

  if (!nodes.some(isActionNode)) return "Add a step that does something — a message, a tag or a webhook";
  if (spec.actions.length > MAX_SPEC_ACTIONS) {
    return `A rule can do ${MAX_SPEC_ACTIONS} things at most, and "text and email" counts as two`;
  }

  const parsed = automationFormSchema.safeParse(specToForm(name, spec));
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

/** A node's payload is plain stored data, so a copy of it is a copy of the data. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The rule builder (`docs/import/WORKIZ_AUTOMATION_BUILDER_UI.md`): the rule
 * as a chain of steps with a "+" between them, drawn as Workiz draws its
 * builder (pg_automations_wz_20_builder_blank / _31_edit — 2026-10-09 rule:
 * the whole app looks like Workiz): the white Center modal with "‹ Back to
 * automations", the slate canvas, the "Rule title" box, every step a line of
 * the 32px sentence with its bullet on a dashed connector, the checks as
 * "Only if …" lines, and the foot with "Automation will be sent" and the
 * yellow Add / Update automation. The chosen step's settings open under its
 * line, as a Workiz slot opens its menu under the word.
 *
 * It replaces the seven stacked sections of `automation-form-dialog`, and
 * saves through exactly what that saved through (`chainToSpec` → `toSpec`), so
 * a rule opened and saved without a change is stored as it was found.
 */
export function AutomationBuilderDialog({
  rule,
  draft,
  open,
  labels,
  onOpenChange,
}: {
  rule?: AutomationRule;
  draft?: AutomationDraft;
  open: boolean;
  labels?: AutomationLabelMap;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateAutomation();
  const create = useCreateAutomation();
  const base = rule?.spec ?? draft?.spec;

  const [name, setName] = useState(rule?.name ?? draft?.name ?? "");
  const [nodes, setNodes] = useState<ChainNode[]>(() => specToChain(base));
  const [delivery, setDelivery] = useState<DeliveryWindowValue>(() => ({
    deliveryWindow: base?.timing?.workingHours ? "between" : "always",
    workingHours: base?.timing?.workingHours ?? { from: "09:00", to: "17:00" },
    quietHours: base?.timing?.quietHours ?? "hold",
  }));
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [testing, setTesting] = useState(false);
  const [showingRuns, setShowingRuns] = useState(false);
  const panelId = useId();
  const chainRef = useRef<HTMLOListElement>(null);
  /** A step whose card should take focus once the chain has been redrawn. */
  const focusAfterRedraw = useRef<string>(undefined);

  // Deleting a step unmounts the menu that deleted it, and that menu hands
  // focus back to a trigger which is no longer in the document — so focus
  // lands on the body and a keyboard reader loses their place in the chain.
  // The card that took the deleted one's place is focused instead. Held in a
  // ref rather than state: it is a one-shot instruction to the DOM, not
  // something the chain is drawn from.
  useEffect(() => {
    const id = focusAfterRedraw.current;
    if (!id) return;
    focusAfterRedraw.current = undefined;
    chainRef.current?.querySelector<HTMLElement>(`[data-step-card="${id}"]`)?.focus();
  });

  /**
   * Everything the chain does not hold, for `chainToSpec` to carry through:
   * the rule's delivery window and what happens outside it, and — for a spec
   * this editor has read but has no node for — whatever else was stored.
   */
  const previous = useMemo<AutomationSpec>(
    () => ({
      ...(base ?? { version: 1, trigger: { kind: "deal.status_changed" as const }, actions: [] }),
      timing: {
        ...base?.timing,
        quietHours: delivery.quietHours,
        workingHours: delivery.deliveryWindow === "between" ? delivery.workingHours : undefined,
      },
    }),
    [base, delivery],
  );

  const spec = useMemo(() => chainToSpec(nodes, previous), [nodes, previous]);
  const named = useMemo<AutomationLabelMap>(() => ({ ...labels }), [labels]);
  const sentence = useMemo(() => specSentence(spec, named), [spec, named]);
  const problem = useMemo(() => saveProblem(name, nodes, spec), [name, nodes, spec]);

  const selected = nodes.find((n) => n.id === selectedId);
  const hasWait = nodes.some((n) => n.kind === "wait");
  const saving = rule ? update.isPending : create.isPending;

  const insertAt = (at: number, kind: Parameters<typeof newChainNode>[0]) => {
    const node = newChainNode(kind);
    setNodes((current) => [...current.slice(0, at), node, ...current.slice(at)]);
    // A step just added is the step somebody is about to fill in.
    setSelectedId(node.id);
  };

  const duplicate = (id: string) => {
    const at = nodes.findIndex((n) => n.id === id);
    if (at < 0) return;
    const copy: ChainNode = { ...clone(nodes[at]), id: nextNodeId() };
    setNodes((current) => [...current.slice(0, at + 1), copy, ...current.slice(at + 1)]);
    setSelectedId(copy.id);
  };

  const remove = (id: string) => {
    const at = nodes.findIndex((n) => n.id === id);
    setNodes((current) => current.filter((n) => n.id !== id));
    setSelectedId((current) => (current === id ? undefined : current));
    // The step that slides up into this one's place, or the one above it when
    // the last step went — where a reader's eye and the caret both end up.
    focusAfterRedraw.current = nodes[at + 1]?.id ?? nodes[at - 1]?.id;
  };

  const submit = () => {
    if (problem) return;
    const body = { name: name.trim(), spec };
    const close = { onSuccess: () => onOpenChange(false) };
    if (rule) update.mutate({ id: rule.id, body }, close);
    // A new rule lands off, so it can be read back before it texts anybody.
    // Said here rather than left to the endpoint's default: whichever way that
    // default goes, a rule created by accident must not start sending.
    else create.mutate({ ...body, enabled: false, category: draft?.category }, close);
  };

  // Workiz's "Preview/edit message" opens the message; here the message is
  // written in its send step's settings, so the button opens the first one.
  const firstSend = nodes.find((n) => n.kind === "send");

  /** Where a step sits, for its share of the dashed connector. */
  const positionOf = (i: number): StepPosition =>
    nodes.length === 1 ? "only" : i === 0 ? "first" : i === nodes.length - 1 ? "last" : "middle";

  // The settings of the chosen step hang under its line, the way a Workiz slot
  // opens its menu under the word; with no step chosen the region is still
  // there — every line names it in `aria-controls` — and says what to do.
  const panel = selected ? (
    <aside
      id={panelId}
      aria-label="Step settings"
      className="relative z-20 mt-3 mb-1 ml-[52px] max-w-[600px] rounded-[8px] bg-white p-4 text-left text-foreground shadow-[0_0_4px_rgba(59,75,82,0.05),0_8px_16px_rgba(59,75,82,0.15)]"
    >
      {/* The way out of the step, at the corner — the panel's own heading
          says which step it is. */}
      <button
        type="button"
        aria-label="Close step settings"
        onClick={() => setSelectedId(undefined)}
        className="absolute top-3 right-3 grid size-6 cursor-pointer place-items-center text-foreground outline-none focus-visible:ring-2 focus-visible:ring-wz-focus"
      >
        <X className="size-4" strokeWidth={1.75} />
      </button>
      <NodePanel
        // Keyed by the step, so choosing another line builds the panel again
        // rather than reusing this one: a panel that survives the switch keeps
        // its own state, and the half-typed message of step 2 would appear
        // under step 3 — and be saved onto it.
        key={selected.id}
        node={selected}
        labels={named}
        chain={nodes}
        disabled={saving}
        onChange={(next) => setNodes((current) => current.map((n) => (n.id === next.id ? next : n)))}
      />
    </aside>
  ) : null;

  /** Workiz's outline pill on the slate canvas ("Preview/edit message"): 40px, #dfe2e3 edge and words. */
  const OUTLINE_ON_SLATE =
    "inline-flex h-10 cursor-pointer items-center justify-center rounded-pill border border-border px-5 text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-border outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-wz-focus";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Workiz's Center with the builder open (pg_automations_wz_20 / _31): the
        // 1344px white modal, 90% of the window tall, 16px corners.
        className="flex h-[90vh] w-[min(1344px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[16px] bg-white p-0 sm:max-w-none"
      >
        {/* The dialog's own name, for the accessibility tree: the visible title
            is the rule's name, which is a field, not a heading. */}
        <DialogTitle className="sr-only">{rule ? "Edit automation" : "Create automation"}</DialogTitle>

        {/* Workiz's way back to the list, 24px in from the corner — the one back
            link this module keeps (an in-page state, not a page header). */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute top-6 left-6 flex cursor-pointer items-center gap-1 text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-wz-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-wz-focus"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Back to automations
        </button>

        <div className="absolute top-[19px] right-[19px] flex items-center gap-2">
          {rule ? (
            <WzDotsMenu
              aria-label="Rule actions"
              items={[
                {
                  key: "runs",
                  label: "Firing log",
                  icon: <History strokeWidth={1.5} />,
                  onSelect: () => setShowingRuns(true),
                },
              ]}
            />
          ) : null}
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="grid size-6 cursor-pointer place-items-center text-foreground outline-none focus-visible:ring-2 focus-visible:ring-wz-focus"
          >
            <X className="size-[18px]" strokeWidth={1.5} />
          </button>
        </div>

        {/* The slate canvas: #3b4b52, 16px corners, 72px under the modal's top,
            16px from its other edges, 40px in. */}
        <div className="mx-4 mt-[72px] mb-4 flex min-h-0 flex-1 flex-col rounded-[16px] bg-[#3b4b52] p-10">
          <div className="-mr-4 min-h-0 flex-1 overflow-y-auto pr-4">
            <div className="mx-auto w-full max-w-[926px] pt-[84px] pb-6">
              {/* AutomationNameInput: 926×50, 1px #768287, 8px corners, the
                  words 16px/24px white 12px 16px in, a blue pencil; #6aa8ee focused. */}
              <div className="flex h-[50px] items-center rounded-[8px] border border-wz-outline-label focus-within:border-wz-link">
                <input
                  aria-label="Name"
                  value={name}
                  placeholder="Rule title"
                  onChange={(e) => setName(e.target.value)}
                  className="h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-base leading-6 tracking-[0.4px] text-white outline-none placeholder:text-white"
                />
                <Pencil className="mr-4 size-[18px] shrink-0 text-wz-link" strokeWidth={1.5} aria-hidden="true" />
              </div>

              {/* Ours: the rule as one sentence, the same one its card shows. */}
              <DialogDescription className="mt-3 text-sm leading-[22px] tracking-[0.4px] text-wz-outline">
                {sentence}
              </DialogDescription>

              {rule && rule.runnable === false ? (
                <p className="mt-3 flex items-start gap-1.5 text-[13px] leading-[19px] tracking-[0.4px] text-[#f5ba45]">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  {rule.notRunnableReason ?? "This rule has nothing the engine can run."}
                </p>
              ) : null}

              <ol className="mt-[42px] flex flex-col" ref={chainRef}>
                {nodes.map((node, i) => (
                  <li key={node.id} className="relative">
                    <AutomationNodeCard
                      node={node}
                      index={i + 1}
                      chain={nodes}
                      labels={named}
                      selected={node.id === selectedId}
                      panelId={panelId}
                      disabled={saving}
                      position={positionOf(i)}
                      onSelect={() => setSelectedId(node.id)}
                      onDuplicate={() => duplicate(node.id)}
                      onDelete={() => remove(node.id)}
                    >
                      {node.id === selectedId ? panel : null}
                    </AutomationNodeCard>
                    {i === nodes.length - 1 ? null : (
                      // On the dashed line, halfway down the gap to the next line.
                      <AddStepButton
                        label={`Add a step after step ${i + 1}, ${KIND_LABEL[node.kind]}`}
                        hasWait={hasWait}
                        disabled={saving}
                        onAdd={(kind) => insertAt(i + 1, kind)}
                        className={cn(
                          "absolute -left-[8.5px] z-10",
                          isBigLine(node) ? "bottom-[15px]" : "bottom-0.5",
                        )}
                      />
                    )}
                  </li>
                ))}
              </ol>

              <AddStepButton
                variant="end"
                label="Add a step at the end"
                hasWait={hasWait}
                disabled={saving}
                onAdd={(kind) => insertAt(nodes.length, kind)}
                className="ml-[25px] w-fit"
              />

              {selected ? null : (
                <aside id={panelId} aria-label="Step settings" className="sr-only">
                  Pick a step to set it up, or add one with the + between them.
                </aside>
              )}
            </div>
          </div>

          {/* The canvas foot: the delivery window left, the buttons right. */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
            <DeliveryWindowControl value={delivery} disabled={saving} onChange={setDelivery} />

            <div className="flex flex-wrap items-center justify-end gap-4">
              {problem ? (
                <span className="max-w-xs text-right text-xs leading-4 tracking-[0.4px] text-wz-outline">{problem}</span>
              ) : null}
              {firstSend ? (
                <button type="button" className={cn(OUTLINE_ON_SLATE, "w-[220px]")} onClick={() => setSelectedId(firstSend.id)}>
                  Preview/edit message
                </button>
              ) : null}
              {/* A dry run needs a saved rule to run — offered once there is one. */}
              {rule ? (
                <button type="button" aria-label="Test against a job" className={OUTLINE_ON_SLATE} onClick={() => setTesting(true)}>
                  Test
                </button>
              ) : null}
              <WzButton
                size="big"
                className="w-[220px]"
                onClick={submit}
                disabled={!!problem}
                loading={saving}
                icon={rule ? undefined : <Plus className="size-6" strokeWidth={1.5} />}
              >
                {rule ? "Update automation" : "Add automation"}
              </WzButton>
            </div>
          </div>
        </div>

        {testing && rule ? (
          <AutomationTestDialog rule={rule} open onOpenChange={(next) => !next && setTesting(false)} />
        ) : null}
        {showingRuns && rule ? (
          <AutomationRunsDialog rule={rule} open onOpenChange={(next) => !next && setShowingRuns(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
