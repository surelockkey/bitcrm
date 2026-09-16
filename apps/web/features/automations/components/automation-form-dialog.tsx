"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  JobSuperStatus,
  automationSentence,
  type AutomationLabelMap,
  type AutomationRule,
} from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { insertAtCursor } from "@/features/messaging/lib";
import { ShortCodeMenu } from "@/features/messaging/components/short-code-menu";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useUpdateAutomation } from "../hooks";
import { TRIGGER_LABEL } from "../lib";
import {
  automationFormSchema,
  specToForm,
  toSpec,
  type AutomationFormValues,
} from "../schemas";
import { AutomationTestDialog } from "./automation-test-dialog";

const SUPER_STATUS_LABEL: Record<string, string> = {
  [JobSuperStatus.SUBMITTED]: "Submitted",
  [JobSuperStatus.IN_PROGRESS]: "In progress",
  [JobSuperStatus.DONE]: "Done",
  [JobSuperStatus.PENDING]: "Pending",
  [JobSuperStatus.DONE_PENDING_APPROVAL]: "Done pending approval",
  [JobSuperStatus.CANCELED]: "Canceled",
};

const CONDITION_FIELD_LABEL: Record<string, string> = {
  status: "Job status",
  subStatus: "Sub-status",
  tag: "Job tag",
  source: "Source",
  jobType: "Job type",
  serviceArea: "Service area",
  hasTechs: "Technician assigned",
  isLead: "Is a job",
};

const OP_LABEL: Record<string, string> = {
  in: "is one of",
  not_in: "is not one of",
  eq: "is",
  ne: "is not",
  exists: "is set",
  not_exists: "is not set",
};

const RECIPIENT_LABEL: Record<string, string> = {
  client: "Client",
  assigned_techs: "Assigned technicians",
  dispatcher: "Dispatcher",
  users: "Selected users",
  role: "A role",
  number: "A number",
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

/**
 * The rule editor (Workiz "Automation Center" → a rule): the trigger, the
 * conditions, what it sends and when. The sentence at the top is the same
 * one the list shows, rebuilt as the form changes, so a dispatcher can
 * read the rule back in English before saving it.
 */
export function AutomationFormDialog({
  rule,
  open,
  labels,
  onOpenChange,
}: {
  rule: AutomationRule;
  open: boolean;
  labels?: AutomationLabelMap;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateAutomation();
  const [values, setValues] = useState<AutomationFormValues>(() => specToForm(rule.name, rule.spec));
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState<Record<number, number>>({});
  const [testing, setTesting] = useState(false);

  const { data: tags } = useJobTags();
  const { data: types } = useJobTypes();
  const { data: sources } = useJobSources();
  const { data: statuses } = useJobStatuses();

  const parsed = useMemo(() => automationFormSchema.safeParse(values), [values]);
  const preview = useMemo(
    () => (parsed.success ? automationSentence(toSpec(parsed.data, rule.spec), labels) : ""),
    [parsed, rule.spec, labels],
  );

  const set = <K extends keyof AutomationFormValues>(key: K, value: AutomationFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const setAction = (index: number, patch: Partial<AutomationFormValues["actions"][number]>) =>
    setValues((v) => ({
      ...v,
      actions: v.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    }));

  const optionsFor = (field: string): Array<{ id: string; name: string }> => {
    if (field === "tag") return tags ?? [];
    if (field === "jobType") return types ?? [];
    if (field === "source") return sources ?? [];
    if (field === "subStatus") return statuses ?? [];
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
    update.mutate(
      { id: rule.id, body: { name: parsed.data.name, spec: toSpec(parsed.data, rule.spec) } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const kind = values.trigger.kind;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit automation</DialogTitle>
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
            <Select value={kind} onValueChange={(v) => set("trigger", { ...values.trigger, kind: v as typeof kind })}>
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
              <div className="space-y-1.5">
                <Label>Status entered</Label>
                <Select
                  value={values.trigger.to?.[0] ?? "any"}
                  onValueChange={(v) =>
                    set("trigger", { ...values.trigger, to: v === "any" ? [] : [v], toSubStatus: [] })
                  }
                >
                  <SelectTrigger aria-label="Status entered">
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
                {values.trigger.toSubStatus?.length ? (
                  <p className="text-xs text-muted-foreground">
                    Sub-status:{" "}
                    {values.trigger.toSubStatus
                      .map((id) => labels?.[id] ?? statuses?.find((s) => s.id === id)?.name ?? id)
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {kind === "call.completed" ? (
              <div className="space-y-1.5">
                <Label>Call outcome</Label>
                <Select
                  value={values.trigger.callOutcome ?? "any"}
                  onValueChange={(v) => set("trigger", { ...values.trigger, callOutcome: v as "any" })}
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

            {kind === "schedule.relative" ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="automation-offset">Minutes from the job</Label>
                  <Input
                    id="automation-offset"
                    type="number"
                    className="w-40"
                    value={values.trigger.offsetMinutes ?? 0}
                    onChange={(e) =>
                      set("trigger", { ...values.trigger, offsetMinutes: Number(e.target.value) })
                    }
                  />
                </div>
                <p className="pb-2 text-xs text-muted-foreground">Negative is before the job starts.</p>
              </div>
            ) : null}
          </section>

          {/* ------------------------------------------------- conditions */}
          <section className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">And only if</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  set("conditions", [...(values.conditions ?? []), { field: "tag", op: "in", values: [] }])
                }
              >
                <Plus className="size-4" /> Condition
              </Button>
            </div>
            {(values.conditions ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No conditions — the trigger alone fires this rule.</p>
            ) : null}
            {(values.conditions ?? []).map((condition, index) => {
              const options = optionsFor(condition.field);
              const selected = condition.values?.[0];
              return (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={condition.field}
                    onValueChange={(v) =>
                      set(
                        "conditions",
                        (values.conditions ?? []).map((c, i) =>
                          i === index ? { ...c, field: v as typeof c.field, values: [], labels: undefined } : c,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="w-44" aria-label={`Condition ${index + 1} field`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONDITION_FIELD_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={condition.op}
                    onValueChange={(v) =>
                      set(
                        "conditions",
                        (values.conditions ?? []).map((c, i) => (i === index ? { ...c, op: v as typeof c.op } : c)),
                      )
                    }
                  >
                    <SelectTrigger className="w-36" aria-label={`Condition ${index + 1} operator`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(OP_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {condition.op === "exists" || condition.op === "not_exists" ? null : options.length ? (
                    <Select
                      value={selected ?? ""}
                      onValueChange={(v) =>
                        set(
                          "conditions",
                          (values.conditions ?? []).map((c, i) =>
                            i === index
                              ? { ...c, values: [v], labels: [options.find((o) => o.id === v)?.name ?? v] }
                              : c,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="w-56" aria-label={`Condition ${index + 1} value`}>
                        <SelectValue placeholder="Pick one" />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className="h-9 px-3 font-normal">
                      {(condition.labels ?? condition.values ?? []).join(", ") || "—"}
                    </Badge>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove condition ${index + 1}`}
                    onClick={() =>
                      set(
                        "conditions",
                        (values.conditions ?? []).filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
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

            {values.actions.map((action, index) => (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={action.type}
                    onValueChange={(v) => setAction(index, { type: v as typeof action.type })}
                  >
                    <SelectTrigger className="w-44" aria-label={`Action ${index + 1} type`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="send_sms">Send SMS</SelectItem>
                      <SelectItem value="send_email">Send email</SelectItem>
                      <SelectItem value="send_in_app">Send in-app</SelectItem>
                      <SelectItem value="webhook">Post webhook</SelectItem>
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
                      value={action.to ?? "client"}
                      onValueChange={(v) => setAction(index, { to: v as typeof action.to })}
                    >
                      <SelectTrigger className="w-52" aria-label={`Action ${index + 1} recipient`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(RECIPIENT_LABEL).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
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

                {action.to === "number" && action.type !== "webhook" ? (
                  <Input
                    placeholder="+14045551234"
                    aria-label={`Action ${index + 1} number`}
                    value={action.number ?? ""}
                    onChange={(e) => setAction(index, { number: e.target.value })}
                  />
                ) : null}

                {action.type === "webhook" ? null : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`automation-body-${index}`}>Message</Label>
                      <ShortCodeMenu
                        compact
                        onInsert={(code) => {
                          const next = insertAtCursor(
                            action.body ?? "",
                            code,
                            caret[index] ?? (action.body ?? "").length,
                          );
                          setAction(index, { body: next.value });
                          setCaret((c) => ({ ...c, [index]: next.caret }));
                        }}
                      />
                    </div>
                    <Textarea
                      id={`automation-body-${index}`}
                      rows={4}
                      value={action.body ?? ""}
                      placeholder="Hi {{first_name}}, your job {{job_id}} is scheduled for {{job_date}}."
                      onChange={(e) => setAction(index, { body: e.target.value })}
                      onSelect={(e) => setCaret((c) => ({ ...c, [index]: e.currentTarget.selectionStart ?? 0 }))}
                    />
                  </div>
                )}
              </div>
            ))}
          </section>

          {/* ------------------------------------------------------ timing */}
          <section className="flex flex-wrap gap-4 rounded-lg border p-4">
            <div className="space-y-1.5">
              <Label>Send</Label>
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
            <div className="space-y-1.5">
              <Label>Quiet hours</Label>
              <Select
                value={values.quietHours ?? "hold"}
                onValueChange={(v) => set("quietHours", v as "hold")}
              >
                <SelectTrigger className="w-52" aria-label="Quiet hours">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hold">Hold until they end</SelectItem>
                  <SelectItem value="skip">Skip the message</SelectItem>
                  <SelectItem value="ignore">Send anyway</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => setTesting(true)}>
            Test against a job
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="brand" onClick={submit} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Save rule
            </Button>
          </div>
        </DialogFooter>

        {testing ? (
          <AutomationTestDialog rule={rule} open onOpenChange={(open) => !open && setTesting(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
