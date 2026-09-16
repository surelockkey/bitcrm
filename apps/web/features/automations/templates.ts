import { JobSuperStatus, type AutomationSpec } from "@bitcrm/types";

/**
 * The recipe library (Workiz "Automation Center" → LIBRARY tab). Each card is
 * a rule somebody can start from in two clicks: a sentence with the parts they
 * edit marked, and a draft the editor opens pre-filled.
 *
 * The catalog is reconstructed from this account's own export
 * (`docs/import/WORKIZ_AUTOMATION_CENTER_UX.md` §1.3, §4.3): every recipe here
 * is one the Workiz library actually offered and this workspace actually took,
 * and the message bodies are the ones it sent, rewritten into BitCRM short
 * codes (`templates/short-codes.ts`). Nothing is invented — a recipe with no
 * evidence behind it is a guess a dispatcher would have to unlearn.
 *
 * Section order is what carries traffic here, not what Workiz listed first:
 * four job-status / phone rules are 79.7% of the 2026 automated messages.
 * Invoice, estimate, payment, lead and service-plan recipes are deliberately
 * absent — money and leads are out of scope until BitCRM has invoices.
 */
export const AUTOMATION_TEMPLATE_SECTIONS = ["Job status", "Phone", "Reminders", "Marketing"] as const;
export type AutomationTemplateSection = (typeof AUTOMATION_TEMPLATE_SECTIONS)[number];

export interface AutomationTemplate {
  /** Stable kebab id — it is what a card is keyed and tested by, so it never changes. */
  id: string;
  section: AutomationTemplateSection;
  /** Workiz's naming convention: `<what it does> / <when or to whom>`. */
  title: string;
  /** The Workiz sentence; `<…>` marks a part the person edits (Workiz underlines these). */
  sentence: string;
  /** One line: when to use it. */
  blurb: string;
  /** What the editor opens with. A status, tag or source the workspace owns is left empty — those are ids, and ids are not portable between workspaces. */
  draft: { name: string; spec: AutomationSpec; category?: string };
  /** It earned its badge: the Workiz rule behind it is one of the busiest in this account. */
  popular?: boolean;
}

const sms = (body: string, to: AutomationSpec["actions"][number]["to"] = "client") =>
  [{ type: "send_sms" as const, to, body }];

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  // ------------------------------------------------------------- Job status
  {
    id: "job-canceled-notify-techs",
    section: "Job status",
    title: "Job canceled / Notify techs",
    sentence: "When a job has a status of <Canceled>, send <the assigned techs> <a text message> immediately",
    blurb: "So a tech already driving to a job that just died hears it before they get there.",
    popular: true,
    draft: {
      name: "Job canceled / Notify techs",
      category: "job",
      spec: {
        version: 1,
        trigger: { kind: "deal.status_changed", to: [JobSuperStatus.CANCELED] },
        conditions: [{ field: "hasTechs", op: "exists" }],
        actions: sms(
          "CLIENT CANCELED\nJob {{job_id}}\n{{first_name}} {{last_name}} at {{full_address}}\n{{description}}",
          "assigned_techs",
        ),
      },
    },
  },
  {
    id: "job-scheduled-notify-techs",
    section: "Job status",
    title: "Job scheduled / Notify techs",
    sentence: "When a job has a status of <Submitted>, send <the assigned techs> <a text message> immediately",
    blurb: "Every tech put on a new job gets the address, the window and what the work is.",
    popular: true,
    draft: {
      name: "Job scheduled / Notify techs",
      category: "job",
      spec: {
        version: 1,
        trigger: { kind: "deal.status_changed", to: [JobSuperStatus.SUBMITTED] },
        conditions: [{ field: "hasTechs", op: "exists" }],
        actions: sms(
          "New scheduled job at {{full_address}}\nTime: {{job_date}} from {{appointment_time}} to {{job_end_time}}\nService: {{description}}\nJob {{job_id}}\nPlease let us know if anything has to change.",
          "assigned_techs",
        ),
      },
    },
  },

  // ------------------------------------------------------------------ Phone
  {
    id: "missed-call-text-client",
    section: "Phone",
    title: "Missed call / Immediate text client",
    sentence: "When a call is missed, send the client <a text message> <immediately>",
    blurb: "A caller nobody picked up hears back in seconds, before they try the next locksmith.",
    popular: true,
    draft: {
      name: "Missed call / Immediate text client",
      category: "phone",
      spec: {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
        conditions: [],
        actions: sms(
          "Hi, sorry we missed your call! Call or text us back at {{biz_number}} and we will help right away. — {{biz_name}}",
        ),
      },
    },
  },
  {
    id: "missed-call-notify-office",
    section: "Phone",
    title: "Missed call / Notify office",
    sentence: "When a call is missed, send <the office> <a text message> immediately",
    blurb: "The office is told at once so somebody calls back — the number is in the call log.",
    draft: {
      name: "Missed call / Notify office",
      category: "phone",
      spec: {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
        conditions: [],
        // Who "the office" is, is a slot: user ids belong to this workspace,
        // so the recipe ships the recipient kind and nobody in it.
        actions: sms("We missed a call — nobody picked up. Please call the client back from the call log.", "users"),
      },
    },
  },
  {
    id: "completed-call-text-client",
    section: "Phone",
    title: "Completed call / Text client",
    sentence: "When a call is answered, send the client <a text message> <immediately>",
    blurb: "After the call ends the caller has your phone, site and email in writing.",
    popular: true,
    draft: {
      name: "Completed call / Text client",
      category: "phone",
      spec: {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "answered", callDirection: "inbound" },
        conditions: [],
        actions: sms(
          "Thank you for calling {{biz_name}}! We are here 24/7.\nPhone: {{biz_number}}\nEmail: {{biz_email}}",
        ),
      },
    },
  },
  {
    id: "voicemail-text-client",
    section: "Phone",
    title: "Voicemail / Immediate text",
    sentence: "When a call goes to voicemail, send the client <a text message> immediately",
    blurb: "Somebody who left a voicemail is told a person is already on it.",
    draft: {
      name: "Voicemail / Immediate text",
      category: "phone",
      spec: {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "voicemail", callDirection: "inbound" },
        conditions: [],
        actions: sms(
          "Thank you for calling {{biz_name}}! Sorry we missed your call — a team member will get back to you shortly. We are here 24/7 at {{biz_number}}.",
        ),
      },
    },
  },

  // -------------------------------------------------------------- Reminders
  {
    id: "one-hour-notice-client-reminder",
    section: "Reminders",
    title: "1 hour notice / Client reminder",
    sentence:
      "When a job has a status of <Submitted>, send the client <a text message> <1 hour> ahead of the job's start",
    blurb: "Cuts no-shows: the client gets the time, the address and a confirm link an hour out.",
    draft: {
      name: "1 hour notice / Client reminder",
      category: "reminders",
      spec: {
        version: 1,
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
        conditions: [{ field: "status", op: "in", values: [JobSuperStatus.SUBMITTED], labels: ["Submitted"] }],
        actions: sms(
          "Hi {{first_name}}, a reminder about your appointment with {{biz_name}}.\nDate: {{job_date}} at {{appointment_time}}\nAddress: {{full_address}}\nTech: {{tech_assigned}}\nPlease confirm here: {{confirm_link}}\nCall or text us with any questions.",
        ),
      },
    },
  },
  {
    id: "one-hour-notice-tech-reminder",
    section: "Reminders",
    title: "1 hour notice / Tech reminder",
    sentence:
      "When a job has a status of <Submitted>, send <the assigned techs> <a text message> <1 hour> ahead of the job's start",
    blurb: "The tech is reminded of the next job an hour out — address, time and the work.",
    draft: {
      name: "1 hour notice / Tech reminder",
      category: "reminders",
      spec: {
        version: 1,
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
        conditions: [{ field: "status", op: "in", values: [JobSuperStatus.SUBMITTED], labels: ["Submitted"] }],
        actions: sms(
          "Reminder: job {{job_id}} starts at {{appointment_time}} today.\nAddress: {{full_address}}\nService: {{description}}",
          "assigned_techs",
        ),
      },
    },
  },

  // -------------------------------------------------------------- Marketing
  {
    id: "collect-reviews-1-day-after",
    section: "Marketing",
    title: "Collect reviews / 1 day after",
    sentence:
      "When a job has a status of <Done>, send the client <a text message> with <your review link> <1 day> after",
    blurb: "Ask while the job is still fresh — paste your own review link into the message.",
    draft: {
      name: "Collect reviews / 1 day after",
      category: "marketing",
      spec: {
        version: 1,
        trigger: { kind: "deal.status_changed", to: [JobSuperStatus.DONE] },
        conditions: [],
        actions: sms(
          "Hi {{first_name}}! Thank you for choosing {{biz_name}}. Would you mind leaving us a review? Here's the link: [paste your review link]\nThanks, we really appreciate it!",
        ),
        timing: { delayMinutes: 1440, quietHours: "hold" },
      },
    },
  },
];
