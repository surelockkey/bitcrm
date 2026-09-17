import { z } from "zod";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_CONDITION_OPS,
  AUTOMATION_RECIPIENTS,
  AUTOMATION_TRIGGER_KINDS,
  isAutomationConditionGroup,
  type AutomationAction,
  type AutomationCondition,
  type AutomationConditionNode,
  type AutomationSpec,
} from "@bitcrm/types";
import { MAX_OFFSET_MINUTES, OFFSET_UNITS, anchorAllowsBefore, joinOffset, splitOffset } from "./lib";

/**
 * The edit form's shape. It is a flattened `AutomationSpec`: one trigger,
 * a list of conditions, a list of actions and the rule's timing — the same
 * four things the Workiz rule editor asked for, in the same order.
 */
// `values` is required rather than defaulted so a row reads the same going in
// as coming out — the editor narrows rows and groups apart by shape, and a
// shape that changes under `parse` would narrow differently on either side.
export const conditionSchema = z.object({
  field: z.enum(AUTOMATION_CONDITION_FIELDS),
  op: z.enum(AUTOMATION_CONDITION_OPS),
  values: z.array(z.string()),
  labels: z.array(z.string()).optional(),
});

/** Workiz's OR: "one of these has to hold", one row of the AND list. */
export const conditionGroupSchema = z.object({
  any: z.array(conditionSchema).max(10),
});

/** One row of "And only if": a plain condition, or an "any of" group of them. */
export const conditionNodeSchema = z.union([conditionGroupSchema, conditionSchema]);

export type ConditionValues = z.infer<typeof conditionSchema>;
export type ConditionGroupValues = z.infer<typeof conditionGroupSchema>;
export type ConditionNodeValues = z.infer<typeof conditionNodeSchema>;

/** Which of the two a row is — the form's own copy of `isAutomationConditionGroup`. */
export function isConditionGroupValues(node: unknown): node is ConditionGroupValues {
  return Array.isArray((node as { any?: unknown } | null)?.any);
}

/**
 * Workiz's `notify_medium: both` ("a text and email", 9 of this account's 80
 * rules). It is one choice in the menu and two actions in the spec, so the
 * spec stays a plain list the engine runs in order.
 */
export const SEND_BOTH = "send_sms_email";

export const FORM_ACTION_TYPES = [...AUTOMATION_ACTION_TYPES, SEND_BOTH] as const;
export type FormActionType = (typeof FORM_ACTION_TYPES)[number];

const sendsEmail = (type: FormActionType) => type === "send_email" || type === SEND_BOTH;
const sendsMessage = (type: FormActionType) =>
  type === "send_sms" || type === "send_email" || type === "send_in_app" || type === SEND_BOTH;

export const actionSchema = z
  .object({
    type: z.enum(FORM_ACTION_TYPES),
    to: z.enum(AUTOMATION_RECIPIENTS).optional(),
    // The lengths are `AutomationActionDto`'s own: what the editor refuses
    // here the API refuses there, and being told which field is too long
    // beats a 400 that loses everything else typed alongside it.
    number: z.string().trim().max(32, "That is not a phone number").optional(),
    email: z.string().trim().max(320, "That address is too long").optional(),
    templateId: z.string().trim().optional(),
    body: z.string().max(5000, "The message is too long — 5000 characters at most").optional(),
    subject: z.string().max(500, "The subject is too long — 500 characters at most").optional(),
    url: z.string().trim().max(2048, "That URL is too long").optional(),
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
    if (sendsMessage(action.type)) {
      if (!action.body?.trim() && !action.templateId) {
        ctx.addIssue({ code: "custom", message: "Write a message or pick a template", path: ["body"] });
      }
      if (action.to === "number" && action.type !== "send_email" && !action.number?.trim()) {
        ctx.addIssue({ code: "custom", message: "Enter the number to text", path: ["number"] });
      }
      if (action.to === "number" && sendsEmail(action.type) && !action.email?.trim()) {
        ctx.addIssue({ code: "custom", message: "Enter the address to email", path: ["email"] });
      }
      // A recipient nobody filled in is the quiet failure this editor exists
      // to end: the engine resolves `users` / `role` to the ids on the action
      // and, with none, to no one at all — for ever, silently.
      if (action.to === "users" && !action.userIds?.length) {
        ctx.addIssue({ code: "custom", message: "Pick at least one person to notify", path: ["userIds"] });
      }
      if (action.to === "role" && !action.roleIds?.length) {
        ctx.addIssue({ code: "custom", message: "Pick at least one role to notify", path: ["roleIds"] });
      }
    }
  });

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * How many actions the spec may hold — `AutomationSpecDto.actions`
 * `@ArrayMaxSize(10)`. Counted after "text and email" is expanded, because
 * that is what the API is handed: six of those rows is twelve actions and a
 * 400 on save, with the rule's whole editing session lost to it.
 */
const MAX_SPEC_ACTIONS = 10;

/** The spec actions one form row becomes. */
const actionCount = (type: FormActionType): number => (type === SEND_BOTH ? 2 : 1);

export const automationFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    trigger: z.object({
      kind: z.enum(AUTOMATION_TRIGGER_KINDS),
      to: z.array(z.string()).default([]),
      toSubStatus: z.array(z.string()).default([]),
      callOutcome: z.enum(["missed", "answered", "voicemail", "any"]).default("any"),
      anchor: z.enum(["scheduledStart", "scheduledEnd", "statusChangedAt", "createdAt"]).default("scheduledStart"),
      // The Workiz timing row, `[N] [unit] [ahead of / after] [anchor]`, is
      // held as it is shown and folded back into `offsetMinutes` on save.
      offsetValue: z.coerce.number().int().min(0).max(MAX_OFFSET_MINUTES).default(0),
      offsetUnit: z.enum(OFFSET_UNITS).default("minutes"),
      offsetDirection: z.enum(["before", "after"]).default("after"),
      // Narrowings the editor does not show but must never widen: the status
      // a job left, "not on creation", the direction of a call, the channel
      // and party of a message.
      from: z.array(z.string()).default([]),
      onCreate: z.boolean().optional(),
      callDirection: z.enum(["inbound", "outbound", "any"]).optional(),
      messageChannel: z.enum(["sms", "email", "in_app", "any"]).optional(),
      messagePartyKind: z.enum(["contact", "company", "user", "none", "any"]).optional(),
    }),
    conditions: z.array(conditionNodeSchema).max(20).default([]),
    actions: z.array(actionSchema).min(1, "A rule needs at least one action").max(10),
    delayMinutes: z.coerce.number().int().min(0).max(43200).default(0),
    quietHours: z.enum(["hold", "skip", "ignore"]).default("hold"),
    /** Workiz "Automation will be sent": 24/7, or only inside a window. */
    deliveryWindow: z.enum(["always", "between"]).default("always"),
    workingHours: z
      .object({ from: z.string(), to: z.string() })
      .default({ from: "09:00", to: "17:00" }),
  })
  .superRefine((values, ctx) => {
    if (values.trigger.kind === "schedule.relative") {
      const minutes = joinOffset({
        value: values.trigger.offsetValue,
        unit: values.trigger.offsetUnit,
        direction: values.trigger.offsetDirection,
      });
      if (Math.abs(minutes) > MAX_OFFSET_MINUTES) {
        ctx.addIssue({
          code: "custom",
          message: "The reminder cannot be more than 30 days from the job",
          path: ["trigger", "offsetValue"],
        });
      }
      if (values.trigger.offsetDirection === "before" && !anchorAllowsBefore(values.trigger.anchor)) {
        ctx.addIssue({
          code: "custom",
          message: "That date has already passed when the rule runs — a reminder ahead of it never fires",
          path: ["trigger", "offsetDirection"],
        });
      }
    }
    if (values.deliveryWindow === "between") {
      for (const edge of ["from", "to"] as const) {
        if (!HH_MM.test(values.workingHours[edge])) {
          ctx.addIssue({ code: "custom", message: "Use a time like 09:00", path: ["workingHours", edge] });
        }
      }
      if (values.workingHours.from === values.workingHours.to) {
        ctx.addIssue({
          code: "custom",
          message: "A window that starts when it ends is the same as 24/7",
          path: ["workingHours", "to"],
        });
      }
      // `placement` in `rule-engine.service.ts` answers "now" on `ignore`
      // before it ever looks at `workingHours`, so a window saved beside it
      // is a window the engine throws away — a rule that reads as 9-to-5 and
      // texts at 3am.
      if (values.quietHours === "ignore") {
        ctx.addIssue({
          code: "custom",
          message: 'A rule that sends anyway has no window — choose "Hold" or "Skip", or send 24/7',
          path: ["quietHours"],
        });
      }
    }
    const actions = values.actions.reduce((n, a) => n + actionCount(a.type), 0);
    if (actions > MAX_SPEC_ACTIONS) {
      ctx.addIssue({
        code: "custom",
        message: `A rule can do ${MAX_SPEC_ACTIONS} things at most, and "text and email" counts as two`,
        path: ["actions"],
      });
    }
  });

export type AutomationFormValues = z.input<typeof automationFormSchema>;
export type AutomationFormOutput = z.output<typeof automationFormSchema>;
export type ActionValues = AutomationFormValues["actions"][number];

const sameIds = (a: string[] | undefined, b: string[] | undefined): boolean =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((id, i) => id === (b ?? [])[i]);

/**
 * Whether these two actions are the one thing Workiz calls "a text and
 * email": the same message, to the same people, on both channels. Deliberately
 * strict — anything that differs beyond the subject and the two address
 * fields stays two rows, so collapsing and expanding can never lose a field.
 */
function pairsAsBoth(sms: AutomationAction, email: AutomationAction): boolean {
  return (
    sms.type === "send_sms" &&
    email.type === "send_email" &&
    (sms.to ?? "client") === (email.to ?? "client") &&
    (sms.body ?? "") === (email.body ?? "") &&
    (sms.templateId ?? "") === (email.templateId ?? "") &&
    sameIds(sms.userIds, email.userIds) &&
    sameIds(sms.roleIds, email.roleIds) &&
    sms.subject === undefined &&
    sms.email === undefined &&
    email.number === undefined
  );
}

const toRow = (c: AutomationCondition): ConditionValues => ({
  field: c.field,
  op: c.op,
  values: c.values ?? [],
  labels: c.labels,
});

const toActionValues = (a: AutomationAction): ActionValues => ({
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
});

/** A stored spec (or nothing, for a new rule) → the form's values. */
export function specToForm(name: string, spec?: AutomationSpec): AutomationFormValues {
  const offset = splitOffset(spec?.trigger.offsetMinutes);
  const actions = spec?.actions ?? [{ type: "send_sms" as const, to: "client" as const, body: "" }];
  const rows: ActionValues[] = [];
  for (let i = 0; i < actions.length; i += 1) {
    const next = actions[i + 1];
    if (next && pairsAsBoth(actions[i], next)) {
      rows.push({ ...toActionValues(actions[i]), type: SEND_BOTH, subject: next.subject, email: next.email });
      i += 1;
      continue;
    }
    rows.push(toActionValues(actions[i]));
  }

  return {
    name,
    trigger: {
      kind: spec?.trigger.kind ?? "deal.status_changed",
      to: spec?.trigger.to ?? [],
      toSubStatus: spec?.trigger.toSubStatus ?? [],
      callOutcome: spec?.trigger.callOutcome ?? "any",
      anchor: spec?.trigger.anchor ?? "scheduledStart",
      offsetValue: offset.value,
      offsetUnit: offset.unit,
      offsetDirection: offset.direction,
      from: spec?.trigger.from ?? [],
      onCreate: spec?.trigger.onCreate,
      callDirection: spec?.trigger.callDirection,
      messageChannel: spec?.trigger.messageChannel,
      messagePartyKind: spec?.trigger.messagePartyKind,
    },
    conditions: (spec?.conditions ?? []).map((node) =>
      isAutomationConditionGroup(node) ? { any: node.any.map(toRow) } : toRow(node),
    ),
    actions: rows,
    delayMinutes: spec?.timing?.delayMinutes ?? 0,
    quietHours: spec?.timing?.quietHours ?? "hold",
    deliveryWindow: spec?.timing?.workingHours ? "between" : "always",
    workingHours: spec?.timing?.workingHours ?? { from: "09:00", to: "17:00" },
  };
}

/** A condition worth storing: one that actually narrows anything. */
const narrows = (c: ConditionValues): boolean =>
  c.op === "exists" || c.op === "not_exists" || c.values.length > 0;

const toCondition = (c: ConditionValues): AutomationCondition => ({
  field: c.field,
  op: c.op,
  ...(c.values.length ? { values: c.values } : {}),
  ...(c.labels?.length ? { labels: c.labels } : {}),
});

/**
 * The rows as the spec stores them. A group keeps only the alternatives that
 * narrow something and disappears when none is left: an `{any: []}` holds for
 * nothing (`evaluator.ts` matchesConditionGroup), so leaving an emptied group
 * behind would switch the rule off without saying so.
 */
function toConditions(rows: AutomationFormOutput["conditions"]): AutomationConditionNode[] {
  return rows.flatMap((node): AutomationConditionNode[] => {
    if (isConditionGroupValues(node)) {
      const any = node.any.filter(narrows).map(toCondition);
      return any.length ? [{ any }] : [];
    }
    return narrows(node) ? [toCondition(node)] : [];
  });
}

/** One message action, shared by the single-channel rows and both halves of "text and email". */
function toMessageAction(
  a: AutomationFormOutput["actions"][number],
  type: "send_sms" | "send_email" | "send_in_app",
): AutomationAction {
  const email = type === "send_email";
  return {
    type,
    ...(a.to ? { to: a.to } : {}),
    // Split only for "text and email": the number belongs to the text half
    // and the address to the email half. A single-channel action keeps both,
    // exactly as it was stored.
    ...(a.to === "number" && a.number && (!email || a.type !== SEND_BOTH) ? { number: a.number } : {}),
    ...(a.to === "number" && a.email && (email || a.type !== SEND_BOTH) ? { email: a.email } : {}),
    ...(a.templateId ? { templateId: a.templateId } : {}),
    ...(a.body?.trim() ? { body: a.body } : {}),
    ...(a.subject?.trim() && (email || a.type !== SEND_BOTH) ? { subject: a.subject } : {}),
    ...(a.userIds?.length ? { userIds: a.userIds } : {}),
    ...(a.roleIds?.length ? { roleIds: a.roleIds } : {}),
  };
}

/**
 * The form's values → what `PATCH /automations/:id` takes. Empty fields are
 * dropped, and everything the editor does not show is carried through the
 * form (`specToForm` reads it, this writes it back) rather than rebuilt from
 * the visible fields, so fixing a typo in a message never widens the rule.
 * A field only ever survives on the trigger it belongs to, so switching the
 * trigger kind still drops what no longer applies.
 */
export function toSpec(values: AutomationFormOutput): AutomationSpec {
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
        ? {
            anchor: values.trigger.anchor,
            offsetMinutes: joinOffset({
              value: values.trigger.offsetValue,
              unit: values.trigger.offsetUnit,
              direction: values.trigger.offsetDirection,
            }),
          }
        : {}),
    },
    conditions: toConditions(values.conditions),
    actions: values.actions.flatMap((a): AutomationAction[] => {
      if (a.type === SEND_BOTH) return [toMessageAction(a, "send_sms"), toMessageAction(a, "send_email")];
      if (a.type === "send_sms" || a.type === "send_email" || a.type === "send_in_app") {
        return [toMessageAction(a, a.type)];
      }
      return [
        {
          type: a.type,
          ...(a.to ? { to: a.to } : {}),
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
        },
      ];
    }),
  };
  const window = values.deliveryWindow === "between" ? values.workingHours : undefined;
  if (values.delayMinutes > 0 || values.quietHours !== "hold" || window) {
    spec.timing = {
      ...(values.delayMinutes > 0 ? { delayMinutes: values.delayMinutes } : {}),
      quietHours: values.quietHours,
      ...(window ? { workingHours: window } : {}),
    };
  }
  return spec;
}
