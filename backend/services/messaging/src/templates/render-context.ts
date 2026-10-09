import type { Address, CustomFieldValue, MessagingSettings } from '@bitcrm/types';

/**
 * What a template is rendered against. Built by `ContextLoader` from ids
 * (conversation / contact / deal / user) or handed in verbatim by a preview.
 * Every field is optional: a short code whose inputs are absent is reported
 * in `missing`, never thrown on.
 */
export interface RenderPerson {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
}

/** The party the message goes to — a CRM contact, or a user for team chat. */
export interface RenderContact {
  firstName?: string;
  lastName?: string;
  phones?: string[];
  emails?: string[];
  addresses?: Address[];
  companyId?: string;
}

/** The job the message is about — a `Deal` subset plus the catalog names the loader resolves. */
export interface RenderDeal {
  id?: string;
  dealNumber?: string;
  contactId?: string;
  companyId?: string;
  scheduledDate?: string;
  scheduledEndDate?: string;
  /** `HH:MM-HH:MM`, wall-clock in the job's zone. */
  scheduledTimeSlot?: string;
  allDay?: boolean;
  address?: Address;
  notes?: string;
  jobTypeId?: string;
  sourceId?: string;
  externalCompanyId?: string;
  assignedTechIds?: string[];
  /** Per-job override of the client's display name. */
  clientName?: { firstName: string; lastName: string };
  /** Answers keyed by custom-field definition id, as stored on the deal. */
  customFields?: Record<string, CustomFieldValue>;
  /**
   * Not on the `Deal` entity today. Honoured when a deal carries it so the
   * design's rule (job zone, else company default) holds without a types change.
   */
  jobTimezone?: string;
  jobTypeName?: string;
  jobSourceName?: string;
  externalCompanyName?: string;
}

/** The CLIENT's company (CRM `Company`) — `{{company_name}}`. The business itself comes from `settings`. */
export interface RenderCompany {
  title?: string;
  phones?: string[];
  emails?: string[];
  address?: string;
}

/**
 * The call a phone-trigger automation (`call.completed`) is about —
 * `{{caller_number}}`, `{{call_status}}`, `{{call_flow}}`. Workiz's call
 * alert has no editable text; ours sends one, so the call has to be sayable.
 * Handed in by the rule engine (`RenderRefs.call`), never loaded: telephony's
 * event carries the numbers and the outcome, and no flow or line name yet —
 * `call_flow` says the dialled line's number until it does.
 */
export interface RenderCall {
  from?: string;
  to?: string;
  direction?: 'inbound' | 'outbound';
  /** How it ended, as the automation trigger saw it. */
  outcome?: 'answered' | 'missed' | 'voicemail';
  /** The call flow that answered the line, once telephony publishes it. */
  flowName?: string;
  /** The line's own name, once telephony publishes it. */
  lineName?: string;
}

export interface RenderContext {
  /** Set for a `call.completed` firing; absent on a job or a message. */
  call?: RenderCall;
  contact?: RenderContact;
  deal?: RenderDeal;
  technician?: RenderPerson;
  company?: RenderCompany;
  /** Deal custom-field answers keyed by definition NAME — `{{Manager Note}}` — resolved by the loader. */
  customFields?: Record<string, CustomFieldValue>;
  /** `MESSAGING#SETTINGS`: `biz_*`, link base URLs, company timezone. */
  settings?: MessagingSettings;
  /** Caller-supplied values that win over everything (`late_value`, a preview's sample data). */
  values?: Record<string, string>;
  /** IANA zone every date/time code is formatted in; the loader resolves it, a preview may pin it. */
  timezone?: string;
}

/** Ids the outbound path and the render routes hand to the loader (design §7.1 `render`). */
export interface RenderRefs {
  conversationId?: string;
  contactId?: string;
  dealId?: string;
  /** The sending user — becomes `technician` when they are on the job's roster (or there is no job). */
  userId?: string;
  values?: Record<string, string>;
  /** The call of a `call.completed` firing, passed through as it is. */
  call?: RenderCall;
}
