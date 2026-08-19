"use client";

import { useState } from "react";
import { Loader2, Phone, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PhoneInput } from "@/components/ui/phone-input";
import { formatPhone } from "@/lib/phone";
import type { CallFlow, CallFlowNode, CallFlowNodeType } from "@bitcrm/types";
import { useCallGroups } from "../call-groups-hooks";
import { useSaveCallFlow } from "../call-flows-hooks";
import {
  STEP_LABEL,
  blankStep,
  newStepId,
  orderedSteps,
  removeStep,
} from "../flow-graph";
import { FlowStepCard } from "./flow-step-card";

const ADDABLE: CallFlowNodeType[] = [
  "say",
  "hours",
  "menu",
  "ring",
  "voicemail",
  "hangup",
];

/** A flow with nothing in it yet: greet, ring, take a message. */
function starterGraph(): { entryNodeId: string; nodes: Record<string, CallFlowNode> } {
  const say = newStepId("say");
  const ring = newStepId("ring");
  const vm = newStepId("voicemail");
  const nodes: Record<string, CallFlowNode> = {
    [say]: { id: say, type: "say", text: "Thanks for calling.", next: ring },
    [ring]: { id: ring, type: "ring", groupId: "", next: vm },
    [vm]: {
      id: vm,
      type: "voicemail",
      prompt: "Please leave a message after the tone.",
      maxSeconds: 120,
    },
  };
  return { entryNodeId: say, nodes };
}

/**
 * The whole flow, step by step.
 *
 * A list rather than a canvas: it reads in the order the call happens, works
 * on a trackpad, and can't be dragged into a tangle. Branching steps indent
 * what hangs off them, which is the one thing a flat list would lose.
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
  const starter = starterGraph();

  const [name, setName] = useState(flow?.name ?? "");
  const [numbers, setNumbers] = useState<string[]>(flow?.numbers ?? []);
  const [draftNumber, setDraftNumber] = useState("");
  const [active, setActive] = useState(flow?.active ?? true);
  const [entryNodeId, setEntryNodeId] = useState(
    flow?.entryNodeId ?? starter.entryNodeId,
  );
  const [nodes, setNodes] = useState<Record<string, CallFlowNode>>(
    flow?.nodes ?? starter.nodes,
  );

  const { data: groups } = useCallGroups(open);
  const save = useSaveCallFlow(flow?.id);

  const steps = orderedSteps({ nodes, entryNodeId });
  const allSteps = Object.values(nodes);

  const addStep = (type: CallFlowNodeType) => {
    const step = blankStep(type);
    setNodes((current) => {
      // New steps land at the end of the main line, which is where somebody
      // adding one almost always means.
      const tailId = [...steps].reverse().find((s) => !s.node.next)?.node.id;
      const withTail =
        tailId && current[tailId]
          ? { ...current, [tailId]: { ...current[tailId], next: step.id } }
          : current;
      return { ...withTail, [step.id]: step };
    });
    if (Object.keys(nodes).length === 0) setEntryNodeId(step.id);
  };

  const addNumber = () => {
    const value = draftNumber.trim();
    if (!value || numbers.includes(value)) return;
    setNumbers((list) => [...list, value]);
    setDraftNumber("");
  };

  const submit = async () => {
    if (!name.trim()) return;
    await save.mutateAsync({
      name: name.trim(),
      numbers,
      entryNodeId,
      nodes,
      active,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${flow.name}` : "New call flow"}</DialogTitle>
          <DialogDescription>
            What a caller hears, and who gets rung, before anybody picks up.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cf-name">Name</Label>
            <Input
              id="cf-name"
              className="h-9"
              value={name}
              placeholder="Main line"
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Answers these numbers</Label>
            {numbers.length ? (
              <ul className="space-y-1.5">
                {numbers.map((number) => (
                  <li
                    key={number}
                    className="flex items-center gap-2 rounded-lg border p-2 text-sm"
                  >
                    <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 font-mono text-[13px]">
                      {formatPhone(number)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Remove ${formatPhone(number)}`}
                      onClick={() =>
                        setNumbers((list) => list.filter((n) => n !== number))
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                No numbers yet — this flow won&apos;t answer anything until one
                is added.
              </p>
            )}
            <div className="flex gap-2">
              <PhoneInput
                className="flex-1"
                value={draftNumber}
                onChange={setDraftNumber}
                placeholder="Add a number…"
              />
              <Button type="button" variant="outline" size="sm" onClick={addNumber}>
                Add
              </Button>
            </div>
          </div>

          {/* the steps */}
          <div className="space-y-2">
            <Label>Steps</Label>
            {steps.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No steps yet. Add one below.
              </p>
            ) : (
              <div className="space-y-2">
                {steps.map(({ node, depth, branch }) => (
                  <FlowStepCard
                    key={node.id}
                    node={node}
                    depth={depth}
                    branch={branch}
                    groups={groups ?? []}
                    steps={allSteps}
                    onChange={(updated) =>
                      setNodes((current) => ({ ...current, [updated.id]: updated }))
                    }
                    onRemove={() =>
                      setNodes((current) => {
                        const next = removeStep(current, node.id);
                        if (node.id === entryNodeId) {
                          setEntryNodeId(Object.keys(next)[0] ?? "");
                        }
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 pt-1">
              {ADDABLE.map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  // Named distinctly from the step card's own title, which
                  // carries the same words.
                  aria-label={`Add step: ${STEP_LABEL[type]}`}
                  onClick={() => addStep(type)}
                >
                  <Plus className="size-3" /> {STEP_LABEL[type]}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">
                A paused flow keeps its steps; its numbers ring everyone online
                instead.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Active" />
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">
            A number can only be answered by one flow.
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              size="sm"
              className="gap-1.5"
              disabled={save.isPending || !name.trim()}
              onClick={submit}
            >
              {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {editing ? "Save flow" : "Create flow"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
