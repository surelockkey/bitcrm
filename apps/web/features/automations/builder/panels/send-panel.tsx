"use client";

import { useState } from "react";
import { Pencil, TriangleAlert } from "lucide-react";
import type {
  AutomationAction,
  AutomationRecipient,
  AutomationScheduleAnchor,
  AutomationTrigger,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ANCHOR_LABEL, splitOffset, triggerHasJob } from "../../lib";
import {
  AutomationRolePicker,
  AutomationUserPicker,
} from "../../components/automation-recipient-picker";
import type { PickerOption } from "../../components/automation-value-picker";
import type { ChainNode } from "../types";
import { PanelField, PanelSection, PanelSentence, Slot } from "./controls";
import { MessageDialog } from "./message-dialog";

/** Recipients read off the job — nobody a call or an inbound message can name. */
const JOB_RECIPIENTS = new Set<AutomationRecipient>(["assigned_techs", "dispatcher"]);

const RECIPIENTS: Array<{ id: AutomationRecipient; name: string; hint?: string }> = [
  { id: "client", name: "the client" },
  { id: "assigned_techs", name: "the assigned tech" },
  { id: "dispatcher", name: "the dispatcher" },
  { id: "role", name: "by role ›", hint: "everyone holding a role" },
  { id: "users", name: "to user ›", hint: "the people you name" },
  { id: "number", name: "a number", hint: "one phone or address, always the same" },
];

const CHANNELS: PickerOption[] = [
  { id: "send_sms", name: "a text message" },
  { id: "send_email", name: "an email" },
  { id: "send_in_app", name: "an in-app message", hint: "shows in the app, sends nothing out" },
  // Workiz's `notify_medium: both` is two actions in the spec and so two
  // steps in the chain. Offered here rather than left out, because "where is
  // text and email?" is asked at exactly this menu, and answered on the row.
  {
    id: "send_both",
    name: "a text and email",
    disabled: true,
    hint: "two messages — add a second Send step for the email",
  },
];

const sendsEmail = (type: AutomationAction["type"]) => type === "send_email";

/** "4 hours ahead of the job's start" — the Workiz timing row, as a phrase. */
function relativeText(trigger: AutomationTrigger): string {
  const anchor = ANCHOR_LABEL[(trigger.anchor ?? "scheduledStart") as AutomationScheduleAnchor];
  const parts = splitOffset(trigger.offsetMinutes);
  if (!parts.value) return `at ${anchor}`;
  const unit = parts.value === 1 ? parts.unit.slice(0, -1) : parts.unit;
  return `${parts.value} ${unit} ${parts.direction === "before" ? "ahead of" : "after"} ${anchor}`;
}

const waitedMinutes = (node: ChainNode): number =>
  node.kind === "wait" ? Math.abs(Math.round(node.waitMinutes ?? 0)) : 0;

/**
 * When this step actually runs, read off the chain rather than off the step.
 *
 * Neither half of it lives on the action: a delay is a `Wait` node (§6 — a
 * wait becomes `timing.delayMinutes`) and a reminder's offset is on the
 * trigger. So the slot says what the chain says and names the step that
 * decides it, instead of offering a second place to set the same number and
 * leaving the reader to guess which one won.
 *
 * Every Wait in the chain counts, not just the ones above this step: the
 * engine holds **one** delay for the whole rule (`AutomationTiming.delayMinutes`,
 * counted from the trigger), so a Wait written below this step holds this step
 * back just the same, and two of them are their sum. Reading only backwards
 * had a message the rule delays by an hour say "immediately".
 */
export function sendTiming(node: ChainNode, chain: ChainNode[]): { text: string; from?: string } {
  const waits = chain.filter((n) => waitedMinutes(n) > 0);
  const minutes = waits.reduce((total, n) => total + waitedMinutes(n), 0);
  if (minutes) {
    const parts = splitOffset(minutes);
    const unit = parts.value === 1 ? parts.unit.slice(0, -1) : parts.unit;
    const at = chain.findIndex((n) => n.id === node.id);
    const from =
      waits.length > 1
        ? "the Wait steps in this chain"
        : chain.indexOf(waits[0]) < (at === -1 ? chain.length : at)
          ? "the Wait step above this one"
          : "the Wait step below this one";
    return { text: `${parts.value} ${unit} after the trigger`, from };
  }
  const trigger = chain.find((n) => n.kind === "trigger")?.trigger;
  if (trigger?.kind === "schedule.relative") {
    return { text: relativeText(trigger), from: "the trigger" };
  }
  return { text: "immediately" };
}

/**
 * The "Send" node (§5.3): `send <the client> <a text message>`, plus who
 * exactly and when. The body is not here — it is behind `Preview/edit
 * message`, with only its first two lines shown, because a rule read at a
 * glance is the whole point of the chain and a paragraph of SMS in the middle
 * of it is not readable.
 */
export function SendPanel({
  node,
  chain,
  onChange,
  disabled,
}: {
  node: ChainNode;
  chain: ChainNode[];
  onChange: (next: ChainNode) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const action: AutomationAction = node.action ?? { type: "send_sms", to: "client" };
  const to = action.to ?? "client";
  const trigger = chain.find((n) => n.kind === "trigger")?.trigger;
  const jobRule = trigger ? triggerHasJob(trigger.kind) : true;
  const stranded = JOB_RECIPIENTS.has(to) && !jobRule;
  const timing = sendTiming(node, chain);

  const emit = (next: AutomationAction) => onChange({ ...node, action: next });

  const lines = (action.body ?? "").split("\n");
  const shown = lines.slice(0, 2).join("\n").trim();

  return (
    <div className="space-y-5">
      <PanelSentence>
        <span>Send</span>
        <Slot
          label="Who it goes to"
          value={to}
          disabled={disabled}
          options={RECIPIENTS.map((r) => {
            const needsJob = JOB_RECIPIENTS.has(r.id) && !jobRule;
            return {
              id: r.id,
              name: r.name,
              disabled: needsJob,
              // Said on the row rather than by hiding it: "the dispatcher"
              // comes off the job, and a rule fired by a call or an inbound
              // message carries no job for it to come off.
              hint: needsJob ? "only on a rule that has a job" : r.hint,
            };
          })}
          onChange={(id) => emit({ ...action, to: id as AutomationRecipient })}
        />
        <Slot
          label="How it goes out"
          value={action.type}
          options={CHANNELS}
          disabled={disabled}
          emptyText="No channel"
          onChange={(id) => {
            const type = id as AutomationAction["type"];
            const next: AutomationAction = { ...action, type };
            // A subject means nothing on a channel with no subject line;
            // leaving it would save a field nothing shows any more.
            if (!sendsEmail(type)) delete next.subject;
            emit(next);
          }}
        />
      </PanelSentence>

      {stranded ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {to === "dispatcher" ? "The dispatcher" : "The assigned tech"} comes off the job, and this
          trigger carries no job — the message would reach nobody. Pick a person, a role or a number
          instead.
        </p>
      ) : null}

      {to === "users" ? (
        <PanelField label="Who exactly">
          <AutomationUserPicker
            label="People to notify"
            values={action.userIds ?? []}
            disabled={disabled}
            onChange={(ids) => emit({ ...action, userIds: ids })}
          />
        </PanelField>
      ) : null}

      {to === "role" ? (
        <PanelField label="Which roles" hint="Every active user holding one of them.">
          <AutomationRolePicker
            label="Roles to notify"
            values={action.roleIds ?? []}
            disabled={disabled}
            onChange={(ids) => emit({ ...action, roleIds: ids })}
          />
        </PanelField>
      ) : null}

      {to === "number" ? (
        <div className="flex flex-wrap gap-3">
          {action.type !== "send_email" ? (
            <PanelField label="Number">
              {(id) => (
                <Input
                  id={id}
                  className="w-52"
                  placeholder="+14045551234"
                  disabled={disabled}
                  value={action.number ?? ""}
                  onChange={(e) => emit({ ...action, number: e.target.value })}
                />
              )}
            </PanelField>
          ) : null}
          {sendsEmail(action.type) ? (
            <PanelField label="Address">
              {(id) => (
                <Input
                  id={id}
                  className="w-64"
                  placeholder="office@example.com"
                  disabled={disabled}
                  value={action.email ?? ""}
                  onChange={(e) => emit({ ...action, email: e.target.value })}
                />
              )}
            </PanelField>
          ) : null}
        </div>
      ) : null}

      <PanelSection title="Message">
        <div className="rounded-lg border bg-muted/40 p-3">
          {shown ? (
            <p className="whitespace-pre-wrap break-words text-xs text-foreground">
              {shown}
              {lines.length > 2 ? <span className="text-muted-foreground"> …</span> : null}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {action.templateId ? "Sent from a saved template." : "Nothing written yet."}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => setEditing(true)}>
          <Pencil className="size-4" /> Preview/edit message
        </Button>
      </PanelSection>

      <PanelSection title="When">
        <p className="text-sm">
          <span className="font-medium">{timing.text}</span>
          {timing.from ? (
            <span className="text-muted-foreground"> — set on {timing.from}</span>
          ) : (
            <span className="text-muted-foreground">
              {" "}
              — add a Wait step above this one to hold it back
            </span>
          )}
        </p>
      </PanelSection>

      {editing ? (
        <MessageDialog
          open
          onOpenChange={(open) => setEditing(open)}
          action={action}
          onChange={emit}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
