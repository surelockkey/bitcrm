import {
  JobSuperStatus,
  type AutomationAction,
  type AutomationCallOutcome,
  type AutomationCondition,
  type AutomationConditionField,
  type AutomationRule,
  type AutomationSpec,
  isAutomationConditionGroup,
} from "@bitcrm/types";
import { SUPER_STATUS_LABEL } from "@/features/automations/lib";

/*
 * Workiz's Notification Center (`/root/notification_center`,
 * notification_center.md §1, §7): one flat list of "custom notifications",
 * each one of four kinds — the first select of its editor, "Who to notify".
 * Here every row is an automation rule filed under `category: 'notification'`
 * (one engine, two doors): these functions compile a form of that editor into
 * an `AutomationSpec` the rule engine runs, read a spec back into the form it
 * came from, and write the row's Description in Workiz's own words.
 */

/** `AutomationRule.category` of every row this page lists. */
export const NOTIFICATION_CATEGORY = "notification";

export const NOTIFICATION_KINDS = ["client_reminder", "tech_reminder", "call_alert", "user_status_alert"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Workiz's "Notify by": Email | SMS | Both ("Both" = a text and an email, two actions). */
export type NotifyBy = "sms" | "email" | "both";

export type ReminderUnit = "hours" | "days";

/** Workiz's "When call is": Completed | Voicemail | Missed | Busy (Busy waits on telephony). */
export type CallStatus = "completed" | "voicemail" | "missed" | "busy";

/**
 * Workiz's "Choose Parameter" rows of a status alert. The three with no
 * condition field yet (External Company, Payment Type, Amount) are offered
 * greyed and never saved.
 */
export const RULE_PARAMS = ["source", "jobType", "tech", "serviceArea"] as const satisfies readonly AutomationConditionField[];
export type RuleParam = (typeof RULE_PARAMS)[number];

export interface StatusRule {
  /** `""` while "Choose Parameter" is still unchosen. */
  param: RuleParam | "";
  values: string[];
  labels?: string[];
}

/** A client / tech reminder: "N hours/days before job start" or "on assignment". */
export interface ReminderForm {
  kind: "client_reminder" | "tech_reminder";
  notifyBy: NotifyBy;
  triggerBy: "time" | "assignment";
  /** 1–30. */
  amount: number;
  unit: ReminderUnit;
  /** E-mail only. */
  subject: string;
  body: string;
}

export interface CallAlertForm {
  kind: "call_alert";
  notifyBy: NotifyBy;
  callStatus: CallStatus;
  userIds: string[];
}

export type StatusPick = { superStatus: JobSuperStatus } | { subStatusId: string };

export interface UserStatusForm {
  kind: "user_status_alert";
  notifyBy: NotifyBy;
  status: StatusPick;
  rules: StatusRule[];
  userIds: string[];
}

export type NotificationForm = ReminderForm | CallAlertForm | UserStatusForm;

/** What the server will add once `backend/notifications` lands; read as a hint, never required. */
export type NotificationRule = AutomationRule & { notificationKind?: NotificationKind };

/* ------------------------------------------------------------- defaults */

/** Workiz writes the call alert itself (no text field); ours has to send something. */
export const CALL_ALERT_BODY =
  "{{call_status}} call from {{caller_number}} on {{call_flow}}. Check the call log for the recording and the client.";

/** The same for a status alert — "Job {{job_id}} is now {{status}}…". */
export const USER_STATUS_BODY =
  "Job {{job_id}} is now {{status}}.\nClient: {{full_name}}\nWhen: {{job_date}} {{appointment_time}}\nWhere: {{full_address}}";
export const USER_STATUS_SUBJECT = "Job {{job_id}} is now {{status}}";

export const DEFAULT_REMINDER_BODY: Record<ReminderForm["kind"], string> = {
  client_reminder:
    "Greetings {{full_name}}.\nThis is a reminder for your upcoming service appointment with {{biz_name}}.\n\nWhen: {{job_date}}\nWhere: {{full_address}}\nTech: {{tech_assigned}}\nIf you have any concerns or updates please do not hesitate to give us a call at {{biz_number}}.\n\nTo confirm your appointment click here: {{confirm_link}}\nSincerely\n{{biz_name}}.",
  tech_reminder: "Service appointment reminder\n\nWhen: {{job_date}}\nWhere: {{full_address}}\nJob type: {{job_type}}",
};
export const DEFAULT_REMINDER_SUBJECT: Record<ReminderForm["kind"], string> = {
  client_reminder: "Your upcoming appointment with {{biz_name}}",
  tech_reminder: "Appointment reminder {{job_date}}",
};

export function emptyForm(kind: NotificationKind): NotificationForm {
  switch (kind) {
    case "client_reminder":
    case "tech_reminder":
      return {
        kind,
        notifyBy: "sms",
        triggerBy: "time",
        amount: 1,
        unit: "hours",
        subject: DEFAULT_REMINDER_SUBJECT[kind],
        body: DEFAULT_REMINDER_BODY[kind],
      };
    case "call_alert":
      return { kind, notifyBy: "sms", callStatus: "completed", userIds: [] };
    case "user_status_alert":
      return { kind, notifyBy: "both", status: { superStatus: JobSuperStatus.SUBMITTED }, rules: [], userIds: [] };
  }
}

/* --------------------------------------------------------------- compile */

const UNIT_MINUTES: Record<ReminderUnit, number> = { hours: 60, days: 1440 };

/** "The job is still on" — what every reminder really requires (the recipes' guard). */
const stillOn = (): AutomationCondition[] => [
  { field: "status", op: "not_in", values: [JobSuperStatus.CANCELED], labels: ["Canceled"] },
  { field: "status", op: "not_in", values: [JobSuperStatus.DONE], labels: ["Done"] },
];

const CALL_OUTCOME: Record<Exclude<CallStatus, "busy">, AutomationCallOutcome> = {
  completed: "answered",
  voicemail: "voicemail",
  missed: "missed",
};

/** One action per channel: "Both" is a text and an e-mail with the same words. */
function sendActions(
  notifyBy: NotifyBy,
  base: Omit<AutomationAction, "type" | "subject">,
  subject: string | undefined,
): AutomationAction[] {
  const sms: AutomationAction = { type: "send_sms", ...base };
  const email: AutomationAction = { type: "send_email", ...base, ...(subject ? { subject } : {}) };
  if (notifyBy === "sms") return [sms];
  if (notifyBy === "email") return [email];
  return [sms, email];
}

/** The editor's form as the spec the engine runs. */
export function toSpec(form: NotificationForm): AutomationSpec {
  switch (form.kind) {
    case "client_reminder":
    case "tech_reminder": {
      const toTechs = form.kind === "tech_reminder";
      const amount = Math.min(30, Math.max(1, Math.round(form.amount)));
      return {
        version: 1,
        trigger:
          form.triggerBy === "assignment"
            ? { kind: "deal.tech_assigned" }
            : { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -amount * UNIT_MINUTES[form.unit] },
        // Without the roster check a tech reminder would arm for jobs nobody is on.
        conditions: toTechs ? [...stillOn(), { field: "hasTechs", op: "exists" }] : stillOn(),
        actions: sendActions(form.notifyBy, { to: toTechs ? "assigned_techs" : "client", body: form.body }, form.subject.trim()),
      };
    }
    case "call_alert":
      return {
        version: 1,
        trigger: {
          kind: "call.completed",
          // Busy has no outcome yet (telephony never publishes it); the form greys it out.
          callOutcome: form.callStatus === "busy" ? "missed" : CALL_OUTCOME[form.callStatus],
          callDirection: "inbound",
        },
        conditions: [],
        actions: sendActions(form.notifyBy, { to: "users", userIds: form.userIds, body: CALL_ALERT_BODY }, undefined),
      };
    case "user_status_alert":
      return {
        version: 1,
        trigger:
          "subStatusId" in form.status
            ? { kind: "deal.status_changed", toSubStatus: [form.status.subStatusId] }
            : { kind: "deal.status_changed", to: [form.status.superStatus] },
        conditions: form.rules
          .filter((r): r is StatusRule & { param: RuleParam } => r.param !== "" && r.values.length > 0)
          .map((r) => ({ field: r.param, op: "in" as const, values: r.values, ...(r.labels ? { labels: r.labels } : {}) })),
        actions: sendActions(form.notifyBy, { to: "users", userIds: form.userIds, body: USER_STATUS_BODY }, USER_STATUS_SUBJECT),
      };
  }
}

/* ------------------------------------------------------------------ read */

const sendTypes = new Set(["send_sms", "send_email"]);

/** SMS / Email / Both off the actions, or nothing when they are not a message pair. */
export function notifyByOf(spec: AutomationSpec): NotifyBy | null {
  const types = spec.actions.map((a) => a.type);
  if (!types.length || types.some((t) => !sendTypes.has(t))) return null;
  const sms = types.includes("send_sms");
  const email = types.includes("send_email");
  if (sms && email) return spec.actions.length === 2 ? "both" : null;
  return spec.actions.length === 1 ? (sms ? "sms" : "email") : null;
}

const sameIds = (a: string[] | undefined, b: string[] | undefined): boolean =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((id, i) => id === (b ?? [])[i]);

/** The actions as one message: every action goes to the same people with the same words. */
function oneMessage(spec: AutomationSpec): AutomationAction | null {
  const [first, ...rest] = spec.actions;
  if (!first) return null;
  for (const a of rest) {
    if ((a.to ?? "client") !== (first.to ?? "client") || (a.body ?? "") !== (first.body ?? "") || !sameIds(a.userIds, first.userIds)) {
      return null;
    }
  }
  return first;
}

const isStillOn = (c: AutomationCondition) => c.field === "status" && c.op === "not_in";
const isRoster = (c: AutomationCondition) => c.field === "hasTechs" && c.op === "exists";
const isRuleParam = (field: string): field is RuleParam => (RULE_PARAMS as readonly string[]).includes(field);

/**
 * A spec back as the form that wrote it, or `null` when none of the four
 * forms can say it — such a rule lives in the Automation Center only.
 */
export function fromSpec(spec: AutomationSpec): NotificationForm | null {
  const notifyBy = notifyByOf(spec);
  const action = oneMessage(spec);
  if (!notifyBy || !action) return null;
  const conditions = spec.conditions ?? [];
  if (conditions.some(isAutomationConditionGroup)) return null;
  const leaves = conditions as AutomationCondition[];
  const subject = spec.actions.find((a) => a.type === "send_email")?.subject ?? "";
  const t = spec.trigger;

  if (t.kind === "schedule.relative" || t.kind === "deal.tech_assigned") {
    if (action.to !== "client" && action.to !== "assigned_techs") return null;
    if (!leaves.every((c) => isStillOn(c) || isRoster(c))) return null;
    const kind = action.to === "client" ? "client_reminder" : "tech_reminder";
    let amount = 1;
    let unit: ReminderUnit = "hours";
    if (t.kind === "schedule.relative") {
      if ((t.anchor ?? "scheduledStart") !== "scheduledStart") return null;
      const minutes = -(t.offsetMinutes ?? 0);
      if (minutes <= 0) return null;
      if (minutes % 1440 === 0) {
        unit = "days";
        amount = minutes / 1440;
      } else if (minutes % 60 === 0) {
        amount = minutes / 60;
      } else return null;
      if (amount > 30) return null;
    }
    return { kind, notifyBy, triggerBy: t.kind === "deal.tech_assigned" ? "assignment" : "time", amount, unit, subject, body: action.body ?? "" };
  }

  if (action.to !== "users") return null;
  const userIds = action.userIds ?? [];

  if (t.kind === "call.completed") {
    const status = (Object.keys(CALL_OUTCOME) as Array<keyof typeof CALL_OUTCOME>).find((k) => CALL_OUTCOME[k] === t.callOutcome);
    if (!status || leaves.length) return null;
    return { kind: "call_alert", notifyBy, callStatus: status, userIds };
  }

  if (t.kind === "deal.status_changed") {
    let status: StatusPick;
    if (t.toSubStatus?.length === 1 && !t.to?.length) status = { subStatusId: t.toSubStatus[0] };
    else if (t.to?.length === 1 && !t.toSubStatus?.length) status = { superStatus: t.to[0] as JobSuperStatus };
    else return null;
    if (t.from?.length) return null;
    const rules: StatusRule[] = [];
    for (const c of leaves) {
      if (c.op !== "in" || !isRuleParam(c.field) || !c.values?.length) return null;
      rules.push({ param: c.field, values: c.values, ...(c.labels ? { labels: c.labels } : {}) });
    }
    return { kind: "user_status_alert", notifyBy, status, rules, userIds };
  }

  return null;
}

/** The kind one of the forms reads this rule as; the server's word when it carries one. */
export function notificationKindOf(rule: NotificationRule): NotificationKind | null {
  if (rule.notificationKind && (NOTIFICATION_KINDS as readonly string[]).includes(rule.notificationKind)) return rule.notificationKind;
  return rule.spec ? (fromSpec(rule.spec)?.kind ?? null) : null;
}

/** A row of the Notifications page: filed under the category, and sayable by one of the four forms. */
export function isNotificationRule(rule: NotificationRule): boolean {
  return rule.category === NOTIFICATION_CATEGORY && !!rule.spec && fromSpec(rule.spec) !== null;
}

/* ------------------------------------------------------------- wording */

/** Who the page knows by name: users (the Notify cell) and sub-statuses. */
export interface NotificationNames {
  users: Record<string, { name: string; email?: string } | undefined>;
  statuses: Record<string, string | undefined>;
}

export interface DescriptionPart {
  text: string;
  bold?: boolean;
}

const NOTIFY_BY_TEXT: Record<NotifyBy, string> = { sms: "SMS", email: "Email", both: "SMS and Email" };
const UNIT_TEXT: Record<ReminderUnit, string> = { hours: "Hours", days: "Days" };
const CALL_STATUS_TEXT: Record<CallStatus, string> = { completed: "Completed", voicemail: "Voicemail", missed: "Missed", busy: "Busy" };

export const UNKNOWN_USER = "Unknown user";

export function notifyByText(notifyBy: NotifyBy): string {
  return NOTIFY_BY_TEXT[notifyBy];
}

export function callStatusText(status: CallStatus): string {
  return CALL_STATUS_TEXT[status];
}

/** "Job Done" / "Pending" — a sub-status by name, a super-status by its word. */
export function statusText(status: StatusPick, names?: Pick<NotificationNames, "statuses">): string {
  if ("subStatusId" in status) return names?.statuses[status.subStatusId] ?? status.subStatusId;
  return SUPER_STATUS_LABEL[status.superStatus] ?? status.superStatus;
}

const userNames = (ids: string[], names: NotificationNames): string =>
  ids.map((id) => names.users[id]?.name ?? UNKNOWN_USER).join(", ") || UNKNOWN_USER;

/**
 * The Description column, in Workiz's own words (notification_center.md §1.1):
 * "Notify tech by SMS 1 Hours before appointment", "Notify <user> when call is
 * **Missed** and assigned to **Any Flow**" — the status and the flow in bold —
 * and, for the status alert Workiz's account never held, "Notify <user> by
 * SMS when job status is **Job Done**".
 */
export function describeNotification(rule: NotificationRule, names: NotificationNames): DescriptionPart[] {
  const form = rule.spec ? fromSpec(rule.spec) : null;
  if (!form) return [];
  switch (form.kind) {
    case "client_reminder":
    case "tech_reminder": {
      const who = form.kind === "client_reminder" ? "client" : "tech";
      const when = form.triggerBy === "assignment" ? "on assignment" : `${form.amount} ${UNIT_TEXT[form.unit]} before appointment`;
      return [{ text: `Notify ${who} by ${NOTIFY_BY_TEXT[form.notifyBy]} ${when}` }];
    }
    case "call_alert": {
      const who = userNames(form.userIds, names);
      const flow: DescriptionPart[] = [{ text: " and assigned to " }, { text: "Any Flow", bold: true }];
      if (form.callStatus === "voicemail") return [{ text: `Notify ${who} when call receives a voicemail` }, ...flow];
      return [{ text: `Notify ${who} when call is ` }, { text: CALL_STATUS_TEXT[form.callStatus], bold: true }, ...flow];
    }
    case "user_status_alert":
      return [
        { text: `Notify ${userNames(form.userIds, names)} by ${NOTIFY_BY_TEXT[form.notifyBy]} when job status is ` },
        { text: statusText(form.status, names), bold: true },
      ];
  }
}

export function describeNotificationText(rule: NotificationRule, names: NotificationNames): string {
  return describeNotification(rule, names)
    .map((p) => p.text)
    .join("");
}

/** The rule's name in the Automation Center: "Tech reminder / 1 hour before", "Call alert / Missed". */
export function notificationName(form: NotificationForm, names?: Pick<NotificationNames, "statuses">): string {
  switch (form.kind) {
    case "client_reminder":
    case "tech_reminder": {
      const who = form.kind === "client_reminder" ? "Client reminder" : "Tech reminder";
      if (form.triggerBy === "assignment") return `${who} / On assignment`;
      const unit = form.unit === "days" ? "day" : "hour";
      return `${who} / ${form.amount} ${unit}${form.amount === 1 ? "" : "s"} before`;
    }
    case "call_alert":
      return `Call alert / ${CALL_STATUS_TEXT[form.callStatus]}`;
    case "user_status_alert":
      return `Job status alert / ${statusText(form.status, names)}`;
  }
}
