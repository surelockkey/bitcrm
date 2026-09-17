"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, History, Info, Loader2, MoreVertical, Pencil, X } from "lucide-react";
import type { AutomationLabelMap, AutomationRule, AutomationSpec } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCreateAutomation, useUpdateAutomation } from "../hooks";
import { specSentence } from "../lib";
import { automationFormSchema, specToForm } from "../schemas";
import { AutomationRunsDialog } from "../components/automation-runs-dialog";
import { AutomationTestDialog } from "../components/automation-test-dialog";
import { AddStepButton } from "./add-step-menu";
import { DeliveryWindowControl, type DeliveryWindowValue } from "./delivery-window";
import { AutomationNodeCard } from "./node-card";
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
 * as a chain of nodes with a "+" between them, and the settings of whichever
 * node is selected beside it. The owner asked for Zapier's chain and Workiz's
 * words, and for our own components under both.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[92vw] max-w-[92vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,92vw)]">
        <DialogHeader className="flex-row items-center gap-2 border-b p-3 pr-12">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <ChevronLeft />
            Back to automations
          </Button>

          {/* Workiz puts the rule's name at the top with a pencil on it; the
              pencil is the affordance, the field is the thing. */}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <Input
              aria-label="Name"
              value={name}
              placeholder="Name this rule"
              onChange={(e) => setName(e.target.value)}
              className="h-8 max-w-xs border-transparent bg-transparent font-medium shadow-none hover:border-input focus-visible:border-input"
            />
            <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>

          {/* The dialog's own name, for the accessibility tree: the visible
              title is the rule's name, which is a field, not a heading. */}
          <DialogTitle className="sr-only">{rule ? "Edit automation" : "Create automation"}</DialogTitle>

          {rule ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Rule actions">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => setShowingRuns(true)}>
                  <History />
                  Firing log
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
          {/* ------------------------------------------------------ the chain */}
          <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto w-full max-w-md space-y-3">
              <DialogDescription className="text-sm text-muted-foreground">{sentence}</DialogDescription>

              {rule && rule.runnable === false ? (
                <p className="flex items-start gap-1.5 rounded-lg border border-dashed p-2 text-xs text-muted-foreground">
                  <Info className="mt-px size-3.5 shrink-0" />
                  {rule.notRunnableReason ?? "This rule has nothing the engine can run."}
                </p>
              ) : null}

              <ol className="flex flex-col" ref={chainRef}>
                {nodes.map((node, i) => (
                  <li key={node.id}>
                    <AutomationNodeCard
                      node={node}
                      index={i + 1}
                      chain={nodes}
                      labels={named}
                      selected={node.id === selectedId}
                      panelId={panelId}
                      disabled={saving}
                      onSelect={() => setSelectedId(node.id)}
                      onDuplicate={() => duplicate(node.id)}
                      onDelete={() => remove(node.id)}
                    />
                    <div className="flex flex-col items-center gap-1 py-1">
                      <span className="h-3 w-px bg-border" aria-hidden="true" />
                      <AddStepButton
                        label={
                          i === nodes.length - 1
                            ? "Add a step at the end"
                            : `Add a step after step ${i + 1}, ${KIND_LABEL[node.kind]}`
                        }
                        hasWait={hasWait}
                        disabled={saving}
                        onAdd={(kind) => insertAt(i + 1, kind)}
                      />
                      {i === nodes.length - 1 ? null : <span className="h-3 w-px bg-border" aria-hidden="true" />}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* ------------------------------------------------- the node panel */}
          <aside
            id={panelId}
            aria-label="Step settings"
            className={cn(
              "min-h-0 overflow-y-auto border-border bg-background p-4",
              // Under ~1100px the chain keeps the whole width and the settings
              // come up from the bottom, as a sheet over it.
              "max-[1099px]:fixed max-[1099px]:inset-x-0 max-[1099px]:bottom-0 max-[1099px]:z-20 max-[1099px]:max-h-[60vh] max-[1099px]:rounded-t-xl max-[1099px]:border-t max-[1099px]:shadow-lg",
              "min-[1100px]:static min-[1100px]:border-l",
              selected ? null : "max-[1099px]:hidden",
            )}
          >
            {selected ? (
              <>
                {/* Which step this is, and the way out of it — below 1100px
                    the panel is a sheet over the chain, and a sheet with no
                    way back is a trap. */}
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Step {nodes.indexOf(selected) + 1} · {KIND_LABEL[selected.kind]}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Close step settings"
                    onClick={() => setSelectedId(undefined)}
                  >
                    <X />
                  </Button>
                </div>
                <NodePanel
                  // Keyed by the step, so choosing another card builds the
                  // panel again rather than reusing this one: a panel that
                  // survives the switch keeps its own state, and the half-typed
                  // message of step 2 would appear under step 3 — and be saved
                  // onto it.
                  key={selected.id}
                  node={selected}
                  labels={named}
                  chain={nodes}
                  disabled={saving}
                  onChange={(next) =>
                    setNodes((current) => current.map((n) => (n.id === next.id ? next : n)))
                  }
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pick a step to set it up, or add one with the + between them.
              </p>
            )}
          </aside>
        </div>

        {/* ----------------------------------------------------------- footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
          <DeliveryWindowControl value={delivery} disabled={saving} onChange={setDelivery} />

          <div className="flex items-center gap-2">
            {problem ? (
              <span className="max-w-xs text-right text-xs text-muted-foreground">{problem}</span>
            ) : null}
            {/* A dry run needs a saved rule to run — offer it once there is one. */}
            {rule ? (
              <Button variant="outline" aria-label="Test against a job" onClick={() => setTesting(true)}>
                Test
              </Button>
            ) : null}
            <Button variant="brand" onClick={submit} disabled={!!problem || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {rule ? "Save" : "Create automation"}
            </Button>
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
