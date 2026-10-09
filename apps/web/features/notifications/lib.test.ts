import { describe, expect, it } from "vitest";
import { JobSuperStatus, type AutomationRule, type AutomationSpec } from "@bitcrm/types";
import {
  CALL_ALERT_BODY,
  NOTIFICATION_CATEGORY,
  USER_STATUS_BODY,
  describeNotification,
  describeNotificationText,
  fromSpec,
  isNotificationRule,
  notificationKindOf,
  notificationName,
  notifyByCell,
  notifyByOf,
  toSpec,
  type NotificationForm,
} from "./lib";

const rule = (spec: AutomationSpec, extra: Partial<AutomationRule> = {}): AutomationRule => ({
  id: "r1",
  name: "x",
  enabled: false,
  category: NOTIFICATION_CATEGORY,
  spec,
  createdAt: "",
  updatedAt: "",
  ...extra,
});

const names = {
  users: { u1: { name: "System admin", email: "system.admin@surelockkey.com" } },
  statuses: { s1: "Job Done" },
};

/* ------------------------------------------------------------ compile */

describe("toSpec", () => {
  it("compiles a tech reminder by time into schedule.relative with the still-on guards", () => {
    const form: NotificationForm = {
      kind: "tech_reminder",
      notifyBy: "sms",
      triggerBy: "time",
      amount: 1,
      unit: "hours",
      subject: "",
      body: "Reminder {{job_id}}",
    };
    expect(toSpec(form)).toEqual({
      version: 1,
      trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
      conditions: [
        { field: "status", op: "not_in", values: [JobSuperStatus.CANCELED], labels: ["Canceled"] },
        { field: "status", op: "not_in", values: [JobSuperStatus.DONE], labels: ["Done"] },
        { field: "hasTechs", op: "exists" },
      ],
      actions: [{ type: "send_sms", to: "assigned_techs", body: "Reminder {{job_id}}" }],
    });
  });

  it("compiles a client reminder in days by email with its subject, and Both as two actions", () => {
    const form: NotificationForm = {
      kind: "client_reminder",
      notifyBy: "both",
      triggerBy: "time",
      amount: 2,
      unit: "days",
      subject: "Your appointment",
      body: "Hi {{full_name}}",
    };
    const spec = toSpec(form);
    expect(spec.trigger).toEqual({ kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -2880 });
    expect(spec.conditions).toEqual([
      { field: "status", op: "not_in", values: [JobSuperStatus.CANCELED], labels: ["Canceled"] },
      { field: "status", op: "not_in", values: [JobSuperStatus.DONE], labels: ["Done"] },
    ]);
    expect(spec.actions).toEqual([
      { type: "send_sms", to: "client", body: "Hi {{full_name}}" },
      { type: "send_email", to: "client", body: "Hi {{full_name}}", subject: "Your appointment" },
    ]);
  });

  it("compiles 'On Assignment' into deal.tech_assigned", () => {
    const form: NotificationForm = {
      kind: "client_reminder",
      notifyBy: "email",
      triggerBy: "assignment",
      amount: 1,
      unit: "hours",
      subject: "On the way",
      body: "Tech {{tech_assigned}}",
    };
    const spec = toSpec(form);
    expect(spec.trigger).toEqual({ kind: "deal.tech_assigned" });
    expect(spec.actions).toEqual([{ type: "send_email", to: "client", body: "Tech {{tech_assigned}}", subject: "On the way" }]);
  });

  it("compiles a call alert into call.completed with the default text", () => {
    const form: NotificationForm = { kind: "call_alert", notifyBy: "sms", callStatus: "missed", userIds: ["u1"] };
    expect(toSpec(form)).toEqual({
      version: 1,
      trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
      conditions: [],
      actions: [{ type: "send_sms", to: "users", userIds: ["u1"], body: CALL_ALERT_BODY }],
    });
    expect(toSpec({ ...form, callStatus: "completed" }).trigger.callOutcome).toBe("answered");
    expect(toSpec({ ...form, callStatus: "voicemail" }).trigger.callOutcome).toBe("voicemail");
  });

  it("compiles a user status alert on a super-status, and on a sub-status, with its rules", () => {
    const form: NotificationForm = {
      kind: "user_status_alert",
      notifyBy: "both",
      status: { superStatus: JobSuperStatus.SUBMITTED },
      rules: [{ param: "source", values: ["src1"], labels: ["Yelp"] }],
      userIds: ["u1"],
    };
    expect(toSpec(form)).toEqual({
      version: 1,
      trigger: { kind: "deal.status_changed", to: [JobSuperStatus.SUBMITTED] },
      conditions: [{ field: "source", op: "in", values: ["src1"], labels: ["Yelp"] }],
      actions: [
        { type: "send_sms", to: "users", userIds: ["u1"], body: USER_STATUS_BODY },
        { type: "send_email", to: "users", userIds: ["u1"], body: USER_STATUS_BODY, subject: expect.any(String) },
      ],
    });
    const sub = toSpec({ ...form, status: { subStatusId: "s1" }, rules: [] });
    expect(sub.trigger).toEqual({ kind: "deal.status_changed", toSubStatus: ["s1"] });
    expect(sub.conditions).toEqual([]);
  });

  it("drops a rule row with no parameter or no values", () => {
    const form: NotificationForm = {
      kind: "user_status_alert",
      notifyBy: "sms",
      status: { superStatus: JobSuperStatus.DONE },
      rules: [
        { param: "", values: [] },
        { param: "tech", values: [] },
        { param: "jobType", values: ["jt1"], labels: ["Rekey"] },
      ],
      userIds: ["u1"],
    };
    expect(toSpec(form).conditions).toEqual([{ field: "jobType", op: "in", values: ["jt1"], labels: ["Rekey"] }]);
  });
});

/* --------------------------------------------------------------- read */

describe("fromSpec", () => {
  it("round-trips every kind through toSpec", () => {
    const forms: NotificationForm[] = [
      { kind: "tech_reminder", notifyBy: "sms", triggerBy: "time", amount: 3, unit: "hours", subject: "", body: "A" },
      { kind: "client_reminder", notifyBy: "both", triggerBy: "time", amount: 1, unit: "days", subject: "S", body: "B" },
      { kind: "client_reminder", notifyBy: "email", triggerBy: "assignment", amount: 1, unit: "hours", subject: "S", body: "C" },
      { kind: "call_alert", notifyBy: "both", callStatus: "completed", userIds: ["u1", "u2"] },
      { kind: "call_alert", notifyBy: "sms", callStatus: "voicemail", userIds: ["u1"] },
      {
        kind: "user_status_alert",
        notifyBy: "email",
        status: { subStatusId: "s1" },
        rules: [
          { param: "tech", values: ["u2"], labels: ["Dana"] },
          { param: "serviceArea", values: ["a1", "a2"], labels: ["North", "South"] },
        ],
        userIds: ["u1"],
      },
    ];
    for (const form of forms) expect(fromSpec(toSpec(form)), form.kind).toEqual(form);
  });

  it("reads a reminder's offset into the largest whole unit and ignores the still-on guards", () => {
    const form = fromSpec({
      version: 1,
      trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -1440 },
      conditions: [{ field: "status", op: "not_in", values: ["canceled"] }],
      actions: [{ type: "send_sms", to: "client", body: "Hi" }],
    });
    expect(form).toEqual({
      kind: "client_reminder",
      notifyBy: "sms",
      triggerBy: "time",
      amount: 1,
      unit: "days",
      subject: "",
      body: "Hi",
    });
  });

  it("refuses what the four forms cannot say", () => {
    // Not a whole hour.
    expect(
      fromSpec({
        version: 1,
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -90 },
        actions: [{ type: "send_sms", to: "client", body: "Hi" }],
      }),
    ).toBeNull();
    // After the job, not before.
    expect(
      fromSpec({
        version: 1,
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: 60 },
        actions: [{ type: "send_sms", to: "client", body: "Hi" }],
      }),
    ).toBeNull();
    // A reminder to the dispatcher is not one of the two reminders.
    expect(
      fromSpec({
        version: 1,
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
        actions: [{ type: "send_sms", to: "dispatcher", body: "Hi" }],
      }),
    ).toBeNull();
    // A call alert to a number, or on any outcome.
    expect(
      fromSpec({
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "missed" },
        actions: [{ type: "send_sms", to: "number", number: "+15550001111", body: "x" }],
      }),
    ).toBeNull();
    expect(
      fromSpec({
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "any" },
        actions: [{ type: "send_sms", to: "users", userIds: ["u1"], body: "x" }],
      }),
    ).toBeNull();
    // A status alert with a condition the "Choose Parameter" list has no row for.
    expect(
      fromSpec({
        version: 1,
        trigger: { kind: "deal.status_changed", to: ["done"] },
        conditions: [{ field: "tag", op: "in", values: ["t1"] }],
        actions: [{ type: "send_sms", to: "users", userIds: ["u1"], body: "x" }],
      }),
    ).toBeNull();
    // Other triggers.
    expect(
      fromSpec({ version: 1, trigger: { kind: "deal.created" }, actions: [{ type: "send_sms", to: "client", body: "x" }] }),
    ).toBeNull();
    // A webhook is not a notification.
    expect(
      fromSpec({ version: 1, trigger: { kind: "call.completed", callOutcome: "missed" }, actions: [{ type: "webhook", url: "https://x" }] }),
    ).toBeNull();
  });

  it("reads a tech reminder on assignment", () => {
    expect(
      fromSpec({
        version: 1,
        trigger: { kind: "deal.tech_assigned" },
        conditions: [{ field: "hasTechs", op: "exists" }],
        actions: [{ type: "send_email", to: "assigned_techs", body: "Go", subject: "New job" }],
      }),
    ).toEqual({
      kind: "tech_reminder",
      notifyBy: "email",
      triggerBy: "assignment",
      amount: 1,
      unit: "hours",
      subject: "New job",
      body: "Go",
    });
  });
});

describe("isNotificationRule / notificationKindOf / notifyByOf", () => {
  const spec: AutomationSpec = {
    version: 1,
    trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
    actions: [
      { type: "send_sms", to: "users", userIds: ["u1"], body: "x" },
      { type: "send_email", to: "users", userIds: ["u1"], body: "x" },
    ],
  };

  it("lists a rule of the notification category that one of the four forms can express", () => {
    expect(isNotificationRule(rule(spec))).toBe(true);
    expect(isNotificationRule(rule(spec, { category: "phone" }))).toBe(false);
    expect(isNotificationRule(rule(spec, { category: undefined }))).toBe(false);
    expect(isNotificationRule(rule({ version: 1, trigger: { kind: "deal.created" }, actions: [] }))).toBe(false);
    expect(isNotificationRule({ ...rule(spec), spec: undefined })).toBe(false);
  });

  it("names the kind from the spec, trusting the server's word when it is there", () => {
    expect(notificationKindOf(rule(spec))).toBe("call_alert");
    expect(notificationKindOf({ ...rule(spec), notificationKind: "user_status_alert" } as AutomationRule)).toBe("user_status_alert");
  });

  it("reads SMS / Email / Both off the actions", () => {
    expect(notifyByOf(spec)).toBe("both");
    expect(notifyByOf({ ...spec, actions: [spec.actions[0]] })).toBe("sms");
    expect(notifyByOf({ ...spec, actions: [spec.actions[1]] })).toBe("email");
    // The Notify By column prints Workiz's word; the sentence spells the pair out.
    expect(["sms", "email", "both"].map((v) => notifyByCell(v as "sms" | "email" | "both"))).toEqual(["SMS", "Email", "Both"]);
  });
});

/* ------------------------------------------------------ description */

describe("describeNotification", () => {
  it("says a reminder as Workiz does", () => {
    const tech = rule(
      toSpec({ kind: "tech_reminder", notifyBy: "sms", triggerBy: "time", amount: 1, unit: "hours", subject: "", body: "x" }),
    );
    expect(describeNotificationText(tech, names)).toBe("Notify tech by SMS 1 Hours before appointment");
    const client = rule(
      toSpec({ kind: "client_reminder", notifyBy: "email", triggerBy: "time", amount: 2, unit: "days", subject: "", body: "x" }),
    );
    expect(describeNotificationText(client, names)).toBe("Notify client by Email 2 Days before appointment");
    const both = rule(
      toSpec({ kind: "client_reminder", notifyBy: "both", triggerBy: "assignment", amount: 1, unit: "hours", subject: "", body: "x" }),
    );
    expect(describeNotificationText(both, names)).toBe("Notify client by SMS and Email on assignment");
  });

  it("says a call alert with the status and the flow in bold", () => {
    const missed = rule(toSpec({ kind: "call_alert", notifyBy: "sms", callStatus: "missed", userIds: ["u1"] }));
    expect(describeNotification(missed, names)).toEqual([
      { text: "Notify System admin when call is " },
      { text: "Missed", bold: true },
      { text: " and assigned to " },
      { text: "Any Flow", bold: true },
    ]);
    const voicemail = rule(toSpec({ kind: "call_alert", notifyBy: "sms", callStatus: "voicemail", userIds: ["u1"] }));
    expect(describeNotificationText(voicemail, names)).toBe(
      "Notify System admin when call receives a voicemail and assigned to Any Flow",
    );
    const completed = rule(toSpec({ kind: "call_alert", notifyBy: "both", callStatus: "completed", userIds: ["u1"] }));
    expect(describeNotificationText(completed, names)).toBe("Notify System admin when call is Completed and assigned to Any Flow");
  });

  it("says a status alert with the status in bold, and names a user it does not know as such", () => {
    const sub = rule(
      toSpec({ kind: "user_status_alert", notifyBy: "sms", status: { subStatusId: "s1" }, rules: [], userIds: ["u1"] }),
    );
    expect(describeNotification(sub, names)).toEqual([
      { text: "Notify System admin by SMS when job status is " },
      { text: "Job Done", bold: true },
    ]);
    const sup = rule(
      toSpec({ kind: "user_status_alert", notifyBy: "both", status: { superStatus: JobSuperStatus.DONE }, rules: [], userIds: ["u9"] }),
    );
    expect(describeNotificationText(sup, names)).toBe("Notify Unknown user by SMS and Email when job status is Done");
  });

  it("names several users", () => {
    const two = rule(toSpec({ kind: "call_alert", notifyBy: "sms", callStatus: "missed", userIds: ["u1", "u2"] }));
    expect(describeNotificationText(two, { ...names, users: { ...names.users, u2: { name: "Dana Ruiz", email: "d@x.com" } } })).toBe(
      "Notify System admin, Dana Ruiz when call is Missed and assigned to Any Flow",
    );
  });

  it("says nothing for a rule that is not a notification", () => {
    expect(describeNotification(rule({ version: 1, trigger: { kind: "deal.created" }, actions: [] }), names)).toEqual([]);
  });
});

describe("notificationName", () => {
  it("names the rule after its kind and trigger", () => {
    expect(
      notificationName({ kind: "tech_reminder", notifyBy: "sms", triggerBy: "time", amount: 1, unit: "hours", subject: "", body: "" }),
    ).toBe("Tech reminder / 1 hour before");
    expect(
      notificationName({ kind: "client_reminder", notifyBy: "sms", triggerBy: "time", amount: 2, unit: "days", subject: "", body: "" }),
    ).toBe("Client reminder / 2 days before");
    expect(
      notificationName({ kind: "client_reminder", notifyBy: "sms", triggerBy: "assignment", amount: 1, unit: "hours", subject: "", body: "" }),
    ).toBe("Client reminder / On assignment");
    expect(notificationName({ kind: "call_alert", notifyBy: "sms", callStatus: "missed", userIds: [] })).toBe("Call alert / Missed");
    expect(
      notificationName(
        { kind: "user_status_alert", notifyBy: "sms", status: { subStatusId: "s1" }, rules: [], userIds: [] },
        names,
      ),
    ).toBe("Job status alert / Job Done");
    expect(
      notificationName({ kind: "user_status_alert", notifyBy: "sms", status: { superStatus: JobSuperStatus.PENDING }, rules: [], userIds: [] }),
    ).toBe("Job status alert / Pending");
  });
});
