"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Phone, PhoneOff } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import type { CallFlow, CallFlowNode, CallFlowNodeType } from "@bitcrm/types";
import { useCallGroups } from "../call-groups-hooks";
import { useCallFlows, useSaveCallFlow } from "../call-flows-hooks";
import { useNumbers } from "../numbers-hooks";
import { blankStep } from "../flow-graph";
import {
  appendStep,
  deleteStep,
  newStep,
  reorder,
  replaceStep,
  toGraph,
  toTree,
  type FlowStep,
} from "../flow-tree";
import { FlowCanvas } from "./flow-canvas";

/** A new flow opens on something that already works. */
function starter(): FlowStep[] {
  const greeting = blankStep("say");
  return [
    { node: { ...greeting, type: "say", text: "Thanks for calling." } as CallFlowNode },
    { node: blankStep("ring") },
    { node: blankStep("voicemail") },
  ];
}

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

  const { data: groups } = useCallGroups(open);
  const save = useSaveCallFlow(flow?.id);

  const submit = async () => {
    if (!name.trim()) return;
    const { entryNodeId, nodes } = toGraph(steps);
    await save.mutateAsync({ name: name.trim(), numbers, entryNodeId, nodes, active });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{editing ? `Edit ${flow.name}` : "New call flow"}</DialogTitle>
          <DialogDescription>
            The steps run top to bottom, exactly as the call happens. Drag to
            reorder.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="flex items-end">
              <label className="flex w-full items-center justify-between rounded-lg border px-3 py-1.5">
                <span>
                  <span className="block text-sm font-medium">Live</span>
                  <span className="block text-xs text-muted-foreground">
                    Paused flows ring everyone online.
                  </span>
                </span>
                <Switch
                  checked={active}
                  onCheckedChange={setActive}
                  aria-label="Live"
                />
              </label>
            </div>
          </div>

          <NumberPicker
            selected={numbers}
            currentFlowId={flow?.id}
            onChange={setNumbers}
          />

          <div className="space-y-2">
            <Label>The call</Label>
            <div className="rounded-xl bg-muted/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="size-3.5" /> Somebody calls
              </div>
              <FlowCanvas
                steps={steps}
                groups={groups ?? []}
                onReorder={(path, from, to) =>
                  setSteps((current) => reorder(current, path, from, to))
                }
                onChange={(node) =>
                  setSteps((current) =>
                    replaceStep(current, node.id, (step) => ({ ...step, node })),
                  )
                }
                onDelete={(id) => setSteps((current) => deleteStep(current, id))}
                onAdd={(path, type: CallFlowNodeType) =>
                  setSteps((current) =>
                    appendStep(current, path, newStep(type, blankStep(type))),
                  )
                }
              />
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <PhoneOff className="size-3.5" /> Call ends
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">
            A number can only be answered by one flow.
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={save.isPending} onClick={onClose}>
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

/**
 * Which of the workspace's numbers this flow answers.
 *
 * Picked from the numbers actually owned, not typed: a number that isn't ours
 * can never ring, so letting somebody type one only produces a flow that looks
 * configured and never runs. Numbers already spoken for say which flow has
 * them, because that is the question you'd otherwise have to go and answer.
 */
function NumberPicker({
  selected,
  currentFlowId,
  onChange,
}: {
  selected: string[];
  currentFlowId?: string;
  onChange: (numbers: string[]) => void;
}) {
  const { data: owned, isLoading } = useNumbers(true);
  const { data: flows } = useCallFlows(true);

  const takenBy = (number: string) =>
    (flows ?? []).find(
      (flow) => flow.id !== currentFlowId && flow.numbers.includes(number),
    );

  const toggle = (number: string) =>
    onChange(
      selected.includes(number)
        ? selected.filter((n) => n !== number)
        : [...selected, number],
    );

  return (
    <div className="space-y-1.5">
      <Label>Answers these numbers</Label>
      {isLoading ? (
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
        <ul className="space-y-1.5">
          {owned.map((number) => {
            const taken = takenBy(number.phoneNumber);
            const checked = selected.includes(number.phoneNumber);
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
                    checked={checked}
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
      )}
    </div>
  );
}
