import { z } from "zod";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_CONDITION_OPS,
  AUTOMATION_RECIPIENTS,
  AUTOMATION_TRIGGER_KINDS,
  type AutomationSpec,
} from "@bitcrm/types";

/**
 * The edit form's shape. It is a flattened `AutomationSpec`: one trigger,
 * a list of conditions, a list of actions and the rule's timing — the same
 * four things the Workiz rule editor asked for, in the same order.
 */
export const conditionSchema = z.object({
  field: z.enum(AUTOMATION_CONDITION_FIELDS),
  op: z.enum(AUTOMATION_CONDITION_OPS),
  values: z.array(z.string()).default([]),
  labels: z.array(z.string()).optional(),
});

export const actionSchema = z
  .object({
    type: z.enum(AUTOMATION_ACTION_TYPES),
    to: z.enum(AUTOMATION_RECIPIENTS).optional(),
    number: z.string().trim().optional(),
    email: z.string().trim().optional(),
    templateId: z.string().trim().optional(),
    body: z.string().optional(),
    subject: z.string().optional(),
    url: z.string().trim().optional(),
    userIds: z.array(z.string()).optional(),
    roleIds: z.array(z.string()).optional(),
    // Carried through the form untouched: the editor has no field for any of
    // these, and rebuilding an action without them would quietly change what
    // the rule does (a PUT webhook becomes a POST, its auth header and its
    // JSON body vanish, a tag or sub-status write loses its target).
    method: z.enum(["POST", "PUT"]).optional(),
    headers: z.record(z.string()).optional(),
    payload: z.string().optional(),
    tagId: z.string().optional(),
    superStatus: z.string().optional(),
    subStatusId: z.string().optional(),
  })
  .superRefine((action, ctx) => {
    if (action.type === "webhook") {
      if (!action.url) ctx.addIssue({ code: "custom", message: "A webhook needs a URL", path: ["url"] });
      else if (!/^https?:\/\//i.test(action.url)) {
        ctx.addIssue({ code: "custom", message: "The URL must start with http:// or https://", path: ["url"] });
      }
      return;
    }
    if (action.type === "send_sms" || action.type === "send_email" || action.type === "send_in_app") {
      if (!action.body?.trim() && !action.templateId) {
        ctx.addIssue({ code: "custom", message: "Write a message or pick a template", path: ["body"] });
      }
      if (action.to === "number" && !action.number?.trim()) {
        ctx.addIssue({ code: "custom", message: "Enter the number to text", path: ["number"] });
      }
    }
  });

export const automationFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  trigger: z.object({
    kind: z.enum(AUTOMATION_TRIGGER_KINDS),
    to: z.array(z.string()).default([]),
    toSubStatus: z.array(z.string()).default([]),
    callOutcome: z.enum(["missed", "answered", "voicemail", "any"]).default("any"),
    anchor: z.enum(["scheduledStart", "scheduledEnd", "statusChangedAt", "createdAt"]).default("scheduledStart"),
    offsetMinutes: z.coerce.number().int().min(-43200).max(43200).default(0),
    // Narrowings the editor does not show but must never widen: the status
    // a job left, "not on creation", the direction of a call, the channel
    // and party of a message.
    from: z.array(z.string()).default([]),
    onCreate: z.boolean().optional(),
    callDirection: z.enum(["inbound", "outbound", "any"]).optional(),
    messageChannel: z.enum(["sms", "email", "in_app", "any"]).optional(),
    messagePartyKind: z.enum(["contact", "company", "user", "none", "any"]).optional(),
  }),
  conditions: z.array(conditionSchema).max(20).default([]),
  actions: z.array(actionSchema).min(1, "A rule needs at least one action").max(10),
  delayMinutes: z.coerce.number().int().min(0).max(43200).default(0),
  quietHours: z.enum(["hold", "skip", "ignore"]).default("hold"),
});

export type AutomationFormValues = z.input<typeof automationFormSchema>;
export type AutomationFormOutput = z.output<typeof automationFormSchema>;

/** A stored spec (or nothing, for a new rule) → the form's values. */
export function specToForm(name: string, spec?: AutomationSpec): AutomationFormValues {
  return {
    name,
    trigger: {
      kind: spec?.trigger.kind ?? "deal.status_changed",
      to: spec?.trigger.to ?? [],
      toSubStatus: spec?.trigger.toSubStatus ?? [],
      callOutcome: spec?.trigger.callOutcome ?? "any",
      anchor: spec?.trigger.anchor ?? "scheduledStart",
      offsetMinutes: spec?.trigger.offsetMinutes ?? 0,
      from: spec?.trigger.from ?? [],
      onCreate: spec?.trigger.onCreate,
      callDirection: spec?.trigger.callDirection,
      messageChannel: spec?.trigger.messageChannel,
      messagePartyKind: spec?.trigger.messagePartyKind,
    },
    conditions: (spec?.conditions ?? []).map((c) => ({
      field: c.field,
      op: c.op,
      values: c.values ?? [],
      labels: c.labels,
    })),
    actions: (spec?.actions ?? [{ type: "send_sms", to: "client", body: "" }]).map((a) => ({
      type: a.type,
      to: a.to,
      number: a.number,
      email: a.email,
      templateId: a.templateId,
      body: a.body ?? "",
      subject: a.subject,
      url: a.url,
      userIds: a.userIds,
      roleIds: a.roleIds,
      method: a.method,
      headers: a.headers,
      payload: a.payload,
      tagId: a.tagId,
      superStatus: a.superStatus,
      subStatusId: a.subStatusId,
    })),
    delayMinutes: spec?.timing?.delayMinutes ?? 0,
    quietHours: spec?.timing?.quietHours ?? "hold",
  };
}

/**
 * The form's values → what `PATCH /automations/:id` takes. Empty fields are
 * dropped, and everything the editor does not show is carried through the
 * form (`specToForm` reads it, this writes it back) rather than rebuilt from
 * the visible fields — so fixing a typo in a message never widens the rule.
 * A field only ever survives on the trigger it belongs to, so switching the
 * trigger kind still drops what no longer applies. `previous` supplies the
 * rule's working-hours window, which lives on `timing` and has no form field.
 */
export function toSpec(values: AutomationFormOutput, previous?: AutomationSpec): AutomationSpec {
  const kind = values.trigger.kind;
  const statusTrigger = kind === "deal.status_changed";
  const spec: AutomationSpec = {
    version: 1,
    trigger: {
      kind,
      ...(statusTrigger && values.trigger.to.length ? { to: values.trigger.to } : {}),
      ...(statusTrigger && values.trigger.from.length ? { from: values.trigger.from } : {}),
      ...(statusTrigger && values.trigger.toSubStatus.length
        ? { toSubStatus: values.trigger.toSubStatus }
        : {}),
      ...(statusTrigger && values.trigger.onCreate === false ? { onCreate: false } : {}),
      ...(kind === "call.completed" ? { callOutcome: values.trigger.callOutcome } : {}),
      ...(kind === "call.completed" && values.trigger.callDirection && values.trigger.callDirection !== "any"
        ? { callDirection: values.trigger.callDirection }
        : {}),
      ...(kind === "message.received" && values.trigger.messageChannel
        ? { messageChannel: values.trigger.messageChannel }
        : {}),
      ...(kind === "message.received" && values.trigger.messagePartyKind
        ? { messagePartyKind: values.trigger.messagePartyKind }
        : {}),
      ...(kind === "schedule.relative"
        ? { anchor: values.trigger.anchor, offsetMinutes: values.trigger.offsetMinutes }
        : {}),
    },
    conditions: values.conditions
      .filter((c) => c.op === "exists" || c.op === "not_exists" || c.values.length > 0)
      .map((c) => ({
        field: c.field,
        op: c.op,
        ...(c.values.length ? { values: c.values } : {}),
        ...(c.labels?.length ? { labels: c.labels } : {}),
      })),
    actions: values.actions.map((a) => ({
      type: a.type,
      ...(a.to ? { to: a.to } : {}),
      ...(a.to === "number" && a.number ? { number: a.number } : {}),
      ...(a.to === "number" && a.email ? { email: a.email } : {}),
      ...(a.templateId ? { templateId: a.templateId } : {}),
      ...(a.body?.trim() ? { body: a.body } : {}),
      ...(a.subject?.trim() ? { subject: a.subject } : {}),
      ...(a.type === "webhook" && a.url ? { url: a.url, method: a.method ?? ("POST" as const) } : {}),
      ...(a.type === "webhook" && a.headers && Object.keys(a.headers).length ? { headers: a.headers } : {}),
      ...(a.type === "webhook" && a.payload?.trim() ? { payload: a.payload } : {}),
      ...(a.type === "add_tag" && a.tagId ? { tagId: a.tagId } : {}),
      ...(a.type === "change_sub_status" && a.superStatus ? { superStatus: a.superStatus } : {}),
      ...(a.type === "change_sub_status" && a.subStatusId ? { subStatusId: a.subStatusId } : {}),
      ...(a.userIds?.length ? { userIds: a.userIds } : {}),
      ...(a.roleIds?.length ? { roleIds: a.roleIds } : {}),
    })),
  };
  const workingHours = previous?.timing?.workingHours;
  if (values.delayMinutes > 0 || values.quietHours !== "hold" || workingHours) {
    spec.timing = {
      ...(values.delayMinutes > 0 ? { delayMinutes: values.delayMinutes } : {}),
      quietHours: values.quietHours,
      ...(workingHours ? { workingHours } : {}),
    };
  }
  return spec;
}
