"use client";

import { useState } from "react";
import { Loader2, Phone, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { PhoneInput } from "@/components/ui/phone-input";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import type { CallFlow, RingNode, SayNode, VoicemailNode } from "@bitcrm/types";
import { useCallGroups } from "../call-groups-hooks";
import { useCreateCallFlow, useUpdateCallFlow } from "../call-flows-hooks";

/** Read the three answers back out of a stored step graph. */
function unpack(flow?: CallFlow) {
  const nodes = Object.values(flow?.nodes ?? {});
  const say = nodes.find((n): n is SayNode => n.type === "say");
  const ring = nodes.find((n): n is RingNode => n.type === "ring");
  const vm = nodes.find((n): n is VoicemailNode => n.type === "voicemail");
  return {
    greeting: say?.text ?? "",
    groupId: ring?.groupId ?? "",
    // A new flow takes a message: losing the call is the failure this feature
    // exists to prevent, so hanging up has to be chosen deliberately.
    noAnswer: (flow ? (vm ? "voicemail" : "hangup") : "voicemail") as
      | "voicemail"
      | "hangup",
    voicemailPrompt: vm?.prompt ?? "",
  };
}

/**
 * A flow, as three questions: what the caller hears, who rings, and what
 * happens when nobody answers. The step graph is assembled on the server, so
 * the first flows can't be malformed — the step-by-step editor arrives in P2
 * over the same storage.
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
  const initial = unpack(flow);

  const [name, setName] = useState(flow?.name ?? "");
  const [numbers, setNumbers] = useState<string[]>(flow?.numbers ?? []);
  const [draftNumber, setDraftNumber] = useState("");
  const [greeting, setGreeting] = useState(initial.greeting);
  const [groupId, setGroupId] = useState(initial.groupId);
  const [noAnswer, setNoAnswer] = useState(initial.noAnswer);
  const [voicemailPrompt, setVoicemailPrompt] = useState(initial.voicemailPrompt);
  const [active, setActive] = useState(flow?.active ?? true);

  const { data: groups } = useCallGroups(open);
  const create = useCreateCallFlow();
  const update = useUpdateCallFlow(flow?.id ?? "");
  const pending = create.isPending || update.isPending;

  const addNumber = () => {
    const value = draftNumber.trim();
    if (!value || numbers.includes(value)) return;
    setNumbers((list) => [...list, value]);
    setDraftNumber("");
  };

  const save = async () => {
    if (!name.trim() || !groupId) return;
    const body = {
      name: name.trim(),
      numbers,
      greeting: greeting.trim() || undefined,
      groupId,
      noAnswer,
      voicemailPrompt: voicemailPrompt.trim() || undefined,
      active,
    };
    if (editing) await update.mutateAsync(body);
    else await create.mutateAsync(body);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
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

          {/* which numbers this answers */}
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
                No numbers yet — this flow won&apos;t answer anything until one is
                added.
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

          {/* the three steps */}
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="cf-greeting">1 · The caller hears</Label>
              <Textarea
                id="cf-greeting"
                rows={2}
                value={greeting}
                placeholder="Thanks for calling Sure Lock Key…"
                onChange={(e) => setGreeting(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to start ringing immediately.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cf-group">2 · Then ring</Label>
              <select
                id="cf-group"
                className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">Pick a call group…</option>
                {(groups ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} — {group.members.length} member
                    {group.members.length === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>3 · If nobody answers</Label>
              <div className="flex h-9 items-center gap-1 rounded-md border p-0.5">
                {(["voicemail", "hangup"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={noAnswer === option}
                    onClick={() => setNoAnswer(option)}
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-xs",
                      noAnswer === option
                        ? "bg-brand text-white"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {option === "voicemail" ? "Take a message" : "Say goodbye"}
                  </button>
                ))}
              </div>
              {noAnswer === "voicemail" ? (
                <Textarea
                  rows={2}
                  value={voicemailPrompt}
                  placeholder="Please leave a message after the tone…"
                  onChange={(e) => setVoicemailPrompt(e.target.value)}
                />
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">
                A paused flow keeps its settings; its numbers ring everyone
                online instead.
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
            <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="brand"
              size="sm"
              className="gap-1.5"
              disabled={pending || !name.trim() || !groupId}
              onClick={save}
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {editing ? "Save flow" : "Create flow"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
