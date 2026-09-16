import { JobSuperStatus, type AutomationCondition, type AutomationSpec } from "@bitcrm/types";

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
 * What is NOT copied from Workiz is the plumbing: a recipe has to fire *here*.
 * Three of the Workiz originals hang on "a job has a status of submitted",
 * which in BitCRM is the status of a job nobody has been put on yet — the
 * first assignment moves it to In progress (`deals.service.ts` assignTechs)
 * and publishes `deal.tech_assigned`, not a status change. Those recipes are
 * translated to the event that actually happens, and the reminders ask what
 * they really mean ("the job is still on") instead of naming a status.
 *
 * Section order is what carries traffic here, not what Workiz listed first:
 * four job-status / phone rules are 79.7% of the 2026 automated messages.
 * Invoice, estimate, payment, lead and service-plan recipes are deliberately
 * absent — money and leads are out of scope until BitCRM has invoices. So is
 * Workiz's `Voicemail / Immediate text`: nothing publishes a voicemail flag on
 * `call.completed` (telephony's payload has none, so `callOutcome` only ever
 * answers missed / answered), and a caller who leaves one after a failed dial
 * is already reported as a missed call — the missed-call recipe texts them.
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

/** "The job is still on" — every reminder's real precondition. One value each, because the editor's condition row edits one. */
// Typed as leaves, not as `AutomationSpec["conditions"]`: that list is optional
// and may hold OR groups, neither of which a recipe spreads into.
const stillOn = (): AutomationCondition[] => [
  { field: "status", op: "not_in", values: [JobSuperStatus.CANCELED], labels: ["Canceled"] },
  { field: "status", op: "not_in", values: [JobSuperStatus.DONE], labels: ["Done"] },
];

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
    sentence: "When a technician is put on a job, send <the assigned techs> <a text message> immediately",
    // Workiz fired this on "status = submitted"; here that is the status of a
    // job with an empty roster, so the Workiz shape would text nobody, ever.
    blurb: "Every tech put on a job gets the address, the window and the work — in your own words.",
    popular: true,
    draft: {
      name: "Job scheduled / Notify techs",
      category: "job",
      spec: {
        version: 1,
        trigger: { kind: "deal.tech_assigned" },
        conditions: [],
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
    sentence: "When a call is missed, send <the office number> <a text message> immediately",
    blurb: "Whoever covers the phones is told at once — the caller's number is in the call log.",
    draft: {
      name: "Missed call / Notify office",
      category: "phone",
      spec: {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "missed", callDirection: "inbound" },
        conditions: [],
        // Workiz sent this to a named user. The editor has no user or role
        // picker yet, and a `users` action with nobody in it resolves to no
        // recipient and sends nothing for ever; a number is a slot the editor
        // shows and the form refuses to save empty.
        actions: sms("We missed a call — nobody picked up. Please call the client back from the call log.", "number"),
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

  // -------------------------------------------------------------- Reminders
  {
    id: "one-hour-notice-client-reminder",
    section: "Reminders",
    title: "1 hour notice / Client reminder",
    sentence:
      "When it is <1 hour> before a job starts and the job is not canceled or done, send the client <a text message>",
    blurb: "Cuts no-shows: the client gets the time, the address and a confirm link an hour out.",
    draft: {
      name: "1 hour notice / Client reminder",
      category: "reminders",
      spec: {
        version: 1,
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
        conditions: stillOn(),
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
      "When it is <1 hour> before a job starts and a tech is on it, send <the assigned techs> <a text message>",
    blurb: "The tech is reminded of the next job an hour out — address, time and the work.",
    draft: {
      name: "1 hour notice / Tech reminder",
      category: "reminders",
      spec: {
        version: 1,
        trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -60 },
        // Without the roster check this reminder would arm for jobs nobody is
        // on and then find no one to text.
        conditions: [...stillOn(), { field: "hasTechs", op: "exists" }],
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
