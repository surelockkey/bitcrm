"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  JobSuperStatus,
  automationSentence,
  type AutomationLabelMap,
  type AutomationRule,
  type AutomationScheduleAnchor,
  type AutomationSpec,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShortCodeMenu } from "@/features/messaging/components/short-code-menu";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useCreateAutomation, useUpdateAutomation } from "../hooks";
import {
  ANCHOR_LABEL,
  OFFSET_UNITS,
  TRIGGER_LABEL,
  anchorAllowsBefore,
  triggerHasJob,
  type OffsetUnit,
} from "../lib";
import {
  SEND_BOTH,
  automationFormSchema,
  specToForm,
  toSpec,
  type ActionValues,
  type AutomationFormValues,
  type ConditionNodeValues,
} from "../schemas";
import { AutomationConditionsField, EMPTY_CONDITION } from "./automation-conditions-field";
import { AutomationMessageEditor, type MessageEditorHandle } from "./automation-message-editor";
import { AutomationRolePicker, AutomationUserPicker } from "./automation-recipient-picker";
import { AutomationTestDialog } from "./automation-test-dialog";
import { AutomationValuePicker, type PickerOption } from "./automation-value-picker";

const SUPER_STATUS_LABEL: Record<string, string> = {
  [JobSuperStatus.SUBMITTED]: "Submitted",
  [JobSuperStatus.IN_PROGRESS]: "In progress",
  [JobSuperStatus.DONE]: "Done",
  [JobSuperStatus.PENDING]: "Pending",
  [JobSuperStatus.DONE_PENDING_APPROVAL]: "Done pending approval",
  [JobSuperStatus.CANCELED]: "Canceled",
};

const RECIPIENT_LABEL: Record<string, string> = {
  client: "Client",
  assigned_techs: "Assigned technicians",
  dispatcher: "Dispatcher",
  users: "Selected users",
  role: "A role",
  number: "A number",
};

/** Recipients read off the job — nobody a call or an inbound message can name. */
const JOB_RECIPIENTS = new Set(["assigned_techs", "dispatcher"]);

const ACTION_LABEL: Record<string, string> = {
  send_sms: "Send SMS",
  send_email: "Send email",
  [SEND_BOTH]: "Send text and email",
  send_in_app: "Send in-app",
  webhook: "Post webhook",
  add_tag: "Add a tag",
  change_sub_status: "Change the sub-status",
};

/** What the menu offers; a rule that already does something else keeps saying so. */
const OFFERED_ACTIONS = ["send_sms", "send_email", SEND_BOTH, "send_in_app", "webhook"];

const UNIT_LABEL: Record<OffsetUnit, string> = {
  minutes: "minutes",
  hours: "hours",
  days: "days",
};

const DELAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Immediately" },
  { value: 15, label: "After 15 minutes" },
  { value: 60, label: "After 1 hour" },
  { value: 240, label: "After 4 hours" },
  { value: 1440, label: "After 1 day" },
  { value: 4320, label: "After 3 days" },
  { value: 10080, label: "After 7 days" },
];

const sendsMessage = (type: string) =>
  type === "send_sms" || type === "send_email" || type === "send_in_app" || type === SEND_BOTH;
const sendsEmail = (type: string) => type === "send_email" || type === SEND_BOTH;

/** What a new rule starts from — a library recipe, or nothing at all. */
export interface AutomationDraft {
  name: string;
  spec: AutomationSpec;
  category?: string;
}

/**
 * The rule editor (Workiz "Automation Center" → a rule): the trigger, the
 * conditions, what it sends and when, in the order Workiz asks for them
 * (§1.5, §4.4). The sentence at the top is the same one the list shows,
 * rebuilt as the form changes, so a dispatcher can read the rule back in
 * English before saving it. Without a `rule` it creates one instead,
 * prefilled from `draft` when a recipe supplied it.
 */
export function AutomationFormDialog({
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
  const [values, setValues] = useState<AutomationFormValues>(() =>
    specToForm(rule?.name ?? draft?.name ?? "", base),
  );
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const editors = useRef<Record<number, MessageEditorHandle | null>>({});
  const fieldId = useId();

  const { data: tags } = useJobTags();
  const { data: types } = useJobTypes();
  const { data: sources } = useJobSources();
  const { data: statuses } = useJobStatuses();

  const parsed = useMemo(() => automationFormSchema.safeParse(values), [values]);
  const preview = useMemo(
    () => (parsed.success ? automationSentence(toSpec(parsed.data), labels) : ""),
    [parsed, labels],
  );

  const set = <K extends keyof AutomationFormValues>(key: K, value: AutomationFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const setTrigger = (patch: Partial<AutomationFormValues["trigger"]>) =>
    setValues((v) => ({ ...v, trigger: { ...v.trigger, ...patch } }));

  const setAction = (index: number, patch: Partial<ActionValues>) =>
    setValues((v) => ({
      ...v,
      actions: v.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    }));

  const superStatus = values.trigger.to?.[0];
  const subStatusOptions: PickerOption[] = useMemo(
    () =>
      (statuses ?? [])
        .filter((s) => s.active && (!superStatus || s.group === superStatus))
        .map((s) => ({ id: s.id, name: s.name })),
    [statuses, superStatus],
  );

  const optionsFor = (field: string): PickerOption[] => {
    if (field === "tag") return tags ?? [];
    if (field === "jobType") return types ?? [];
    if (field === "source") return sources ?? [];
    if (field === "subStatus") return (statuses ?? []).map((s) => ({ id: s.id, name: s.name }));
    if (field === "status") {
      return Object.entries(SUPER_STATUS_LABEL).map(([id, name]) => ({ id, name }));
    }
    return [];
  };

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = { name: parsed.data.name, spec: toSpec(parsed.data) };
    const close = { onSuccess: () => onOpenChange(false) };
    if (rule) update.mutate({ id: rule.id, body }, close);
    // A new rule lands off, so it can be read back before it texts anybody.
    // Said here rather than left to the endpoint's default: whichever way
    // that default goes, a rule created by accident must not start sending.
    else create.mutate({ ...body, enabled: false, category: draft?.category }, close);
  };

  const kind = values.trigger.kind;
  const jobRule = triggerHasJob(kind);
  const anchor = (values.trigger.anchor ?? "scheduledStart") as AutomationScheduleAnchor;
  const saving = rule ? update.isPending : create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit automation" : "Create automation"}</DialogTitle>
          <DialogDescription>
            {preview || "Choose a trigger and what to send."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="automation-name">Name</Label>
            <Input
              id="automation-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>

          {/* ---------------------------------------------------- trigger */}
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">When</h3>
            <Select value={kind} onValueChange={(v) => setTrigger({ kind: v as typeof kind })}>
              <SelectTrigger aria-label="Trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {kind === "deal.status_changed" ? (
              <div className="flex flex-wrap gap-3">
                <div className="space-y-1.5">
                  <Label>Status entered</Label>
                  <Select
                    value={superStatus ?? "any"}
                    onValueChange={(v) =>
                      // A sub-status belongs to one super-status, so one that
                      // no longer fits the chosen status cannot be kept.
                      setTrigger({ to: v === "any" ? [] : [v], toSubStatus: [] })
                    }
                  >
                    <SelectTrigger className="w-52" aria-label="Status entered">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any status</SelectItem>
                      {Object.entries(SUPER_STATUS_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label id={`${fieldId}-sub`}>Sub-status</Label>
                  <AutomationValuePicker
                    className="w-64"
                    label="Sub-status entered"
                    options={subStatusOptions}
                    values={values.trigger.toSubStatus ?? []}
                    fallback={labels}
                    placeholder="Any sub-status"
                    emptyText="No sub-statuses here"
                    onChange={(ids) => setTrigger({ toSubStatus: ids })}
                  />
                </div>
              </div>
            ) : null}

            {kind === "call.completed" ? (
              <div className="space-y-1.5">
                <Label>Call outcome</Label>
                <Select
                  value={values.trigger.callOutcome ?? "any"}
                  onValueChange={(v) => setTrigger({ callOutcome: v as "any" })}
                >
                  <SelectTrigger aria-label="Call outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any call</SelectItem>
                    <SelectItem value="missed">Missed</SelectItem>
                    <SelectItem value="answered">Answered</SelectItem>
                    <SelectItem value="voicemail">Voicemail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </section>

          {/* ------------------------------------------------- conditions */}
          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">And only if</h3>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => set("conditions", [...(values.conditions ?? []), { ...EMPTY_CONDITION }])}
                >
                  <Plus className="size-4" /> Condition
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    set("conditions", [
                      ...(values.conditions ?? []),
                      { any: [{ ...EMPTY_CONDITION }, { ...EMPTY_CONDITION }] },
                    ])
                  }
                >
                  <Plus className="size-4" /> Or group
                </Button>
              </div>
            </div>
            <AutomationConditionsField
              conditions={(values.conditions ?? []) as ConditionNodeValues[]}
              onChange={(next) => set("conditions", next)}
              optionsFor={optionsFor}
              labels={labels}
            />
          </section>

          {/* ----------------------------------------------------- actions */}
          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Then</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => set("actions", [...values.actions, { type: "send_sms", to: "client", body: "" }])}
              >
                <Plus className="size-4" /> Action
              </Button>
            </div>

            {values.actions.map((action, index) => {
              const to = action.to ?? "client";
              const strandedRecipient = !jobRule && JOB_RECIPIENTS.has(to);
              const bodyLabelId = `${fieldId}-body-${index}`;
              return (
                <div key={index} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={action.type}
                      onValueChange={(v) =>
                        setAction(index, {
                          type: v as ActionValues["type"],
                          // A subject means nothing on a channel with no
                          // subject line; leaving it would save a field the
                          // editor stopped showing.
                          ...(sendsEmail(v) ? {} : { subject: undefined }),
                        })
                      }
                    >
                      <SelectTrigger className="w-52" aria-label={`Action ${index + 1} type`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[...OFFERED_ACTIONS, ...(OFFERED_ACTIONS.includes(action.type) ? [] : [action.type])].map(
                          (value) => (
                            <SelectItem key={value} value={value}>
                              {ACTION_LABEL[value] ?? value}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>

                    {action.type === "webhook" ? (
                      <Input
                        className="flex-1"
                        placeholder="https://example.com/hook"
                        aria-label={`Action ${index + 1} URL`}
                        value={action.url ?? ""}
                        onChange={(e) => setAction(index, { url: e.target.value })}
                      />
                    ) : (
                      <Select
                        value={to}
                        onValueChange={(v) => setAction(index, { to: v as ActionValues["to"] })}
                      >
                        <SelectTrigger className="w-52" aria-label={`Action ${index + 1} recipient`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(RECIPIENT_LABEL).map(([value, label]) => {
                            const stranded = !jobRule && JOB_RECIPIENTS.has(value);
                            return (
                              <SelectItem key={value} value={value} disabled={stranded}>
                                {stranded ? `${label} — needs a job` : label}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}

                    {values.actions.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove action ${index + 1}`}
                        onClick={() =>
                          set(
                            "actions",
                            values.actions.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>

                  {strandedRecipient ? (
                    <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                      <TriangleAlert className="size-3.5 shrink-0" />
                      {RECIPIENT_LABEL[to]} comes off the job, and this trigger carries no job — the
                      action would reach nobody. Pick a person, a role or a number instead.
                    </p>
                  ) : null}

                  {to === "users" && action.type !== "webhook" ? (
                    <AutomationUserPicker
                      label={`Action ${index + 1} people`}
                      values={action.userIds ?? []}
                      onChange={(ids) => setAction(index, { userIds: ids })}
                    />
                  ) : null}

                  {to === "role" && action.type !== "webhook" ? (
                    <AutomationRolePicker
                      label={`Action ${index + 1} roles`}
                      values={action.roleIds ?? []}
                      onChange={(ids) => setAction(index, { roleIds: ids })}
                    />
                  ) : null}

                  {to === "number" && action.type !== "webhook" ? (
                    <div className="flex flex-wrap gap-2">
                      {action.type !== "send_email" ? (
                        <Input
                          className="w-52"
                          placeholder="+14045551234"
                          aria-label={`Action ${index + 1} number`}
                          value={action.number ?? ""}
                          onChange={(e) => setAction(index, { number: e.target.value })}
                        />
                      ) : null}
                      {sendsEmail(action.type) ? (
                        <Input
                          className="w-64"
                          placeholder="office@example.com"
                          aria-label={`Action ${index + 1} email address`}
                          value={action.email ?? ""}
                          onChange={(e) => setAction(index, { email: e.target.value })}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {sendsEmail(action.type) ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`automation-subject-${index}`}>Subject</Label>
                      <Input
                        id={`automation-subject-${index}`}
                        placeholder="Your appointment with {{biz_name}}"
                        value={action.subject ?? ""}
                        onChange={(e) => setAction(index, { subject: e.target.value })}
                      />
                    </div>
                  ) : null}

                  {sendsMessage(action.type) ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label id={bodyLabelId}>Message</Label>
                        <ShortCodeMenu
                          compact
                          onInsert={(code) =>
                            editors.current[index]?.insertCode(code.replace(/^\{\{|\}\}$/g, ""))
                          }
                        />
                      </div>
                      <AutomationMessageEditor
                        ref={(el) => {
                          editors.current[index] = el;
                        }}
                        labelledBy={bodyLabelId}
                        value={action.body ?? ""}
                        placeholder="Hi {{first_name}}, your job {{job_id}} is scheduled for {{job_date}}."
                        onChange={(body) => setAction(index, { body })}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>

          {/* ------------------------------------------------------ timing */}
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Timing</h3>

            {kind === "schedule.relative" ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="automation-offset">Send</Label>
                  <Input
                    id="automation-offset"
                    type="number"
                    min={0}
                    className="w-24"
                    value={values.trigger.offsetValue ?? 0}
                    onChange={(e) => setTrigger({ offsetValue: Math.abs(Number(e.target.value)) })}
                  />
                </div>
                <Select
                  value={values.trigger.offsetUnit ?? "minutes"}
                  onValueChange={(v) => setTrigger({ offsetUnit: v as OffsetUnit })}
                >
                  <SelectTrigger className="w-32" aria-label="Offset unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OFFSET_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {UNIT_LABEL[unit]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={values.trigger.offsetDirection ?? "after"}
                  onValueChange={(v) => setTrigger({ offsetDirection: v as "before" | "after" })}
                >
                  <SelectTrigger className="w-36" aria-label="Before or after">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before" disabled={!anchorAllowsBefore(anchor)}>
                      ahead of
                    </SelectItem>
                    <SelectItem value="after">after</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={anchor}
                  onValueChange={(v) => {
                    const next = v as AutomationScheduleAnchor;
                    setTrigger({
                      anchor: next,
                      // A date already in the past can only be counted forward
                      // from — the scheduler arms nothing for a moment gone by.
                      ...(anchorAllowsBefore(next) ? {} : { offsetDirection: "after" as const }),
                    });
                  }}
                >
                  <SelectTrigger className="w-52" aria-label="Counted from">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ANCHOR_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>{kind === "schedule.relative" ? "Then wait" : "Send"}</Label>
              <Select
                value={String(values.delayMinutes ?? 0)}
                onValueChange={(v) => set("delayMinutes", Number(v))}
              >
                <SelectTrigger className="w-52" aria-label="Delay">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELAY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* --------------------------------------------- delivery window */}
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Delivery window</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>Automation will be sent</Label>
                <Select
                  value={values.deliveryWindow ?? "always"}
                  onValueChange={(v) => set("deliveryWindow", v as "always" | "between")}
                >
                  <SelectTrigger className="w-52" aria-label="Automation will be sent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">24/7</SelectItem>
                    <SelectItem value="between">Only between set hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {values.deliveryWindow === "between" ? (
                <div className="flex items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="automation-window-from">From</Label>
                    <Input
                      id="automation-window-from"
                      type="time"
                      className="w-32"
                      value={values.workingHours?.from ?? "09:00"}
                      onChange={(e) =>
                        set("workingHours", {
                          from: e.target.value,
                          to: values.workingHours?.to ?? "17:00",
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="automation-window-to">To</Label>
                    <Input
                      id="automation-window-to"
                      type="time"
                      className="w-32"
                      value={values.workingHours?.to ?? "17:00"}
                      onChange={(e) =>
                        set("workingHours", {
                          from: values.workingHours?.from ?? "09:00",
                          to: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Outside those hours</Label>
              <Select
                value={values.quietHours ?? "hold"}
                onValueChange={(v) => set("quietHours", v as "hold")}
              >
                <SelectTrigger className="w-64" aria-label="Outside those hours">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hold">Hold until the window opens</SelectItem>
                  <SelectItem value="skip">Skip the message</SelectItem>
                  <SelectItem value="ignore">Send anyway</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Also decides what happens in the workspace&apos;s quiet hours. Workiz holds — a
                message due outside the window goes out as soon as it opens again.
              </p>
            </div>
          </section>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {/* A dry run needs a saved rule to run — offer it once there is one. */}
          {rule ? (
            <Button variant="outline" onClick={() => setTesting(true)}>
              Test against a job
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="brand" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}{" "}
              {rule ? "Save rule" : "Create automation"}
            </Button>
          </div>
        </DialogFooter>

        {testing && rule ? (
          <AutomationTestDialog rule={rule} open onOpenChange={(open) => !open && setTesting(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
