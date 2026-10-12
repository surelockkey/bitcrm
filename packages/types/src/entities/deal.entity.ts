import { type Address } from './address.entity';
import { type ClientType } from '../enums/client-type.enum';
import { type DealStage, type JobSuperStatus } from '../enums/deal-stage.enum';
import { type DealPriority } from '../enums/deal-priority.enum';
import { type DealStatus } from '../enums/deal-status.enum';
import { type CustomFieldValue } from './custom-field.entity';
import { type DocumentDiscount, type DocumentTaxSource } from '../billing/totals';

/**
 * How a job is handed to a technician (Workiz "Send to tech": SMS / Email /
 * In App). `sms` texts the technician's personal phone, `email` their user
 * email, `in_app` posts into their team thread (the Workiz mobile-app
 * notification). Several may be picked at once ("Sent to tech by SMS & Email").
 */
export const SEND_TO_TECH_CHANNELS = ['sms', 'email', 'in_app'] as const;
export type SendToTechChannel = (typeof SEND_TO_TECH_CHANNELS)[number];

/**
 * What the job is worth, kept on the job so a period can be summed without
 * reading every job's lines: the shared totals formula over its lines, tax
 * and discount, plus what those lines cost the company. Refreshed by the deal
 * service on every line, tax or discount change.
 */
export interface DealTotalsSnapshot {
  subtotal: number;
  discount: number;
  tax: number;
  /** What the client is billed: subtotal − discount + tax. */
  total: number;
  /** Σ quantity × company cost over the lines. */
  cost: number;
  /**
   * The taxable lines less their share of the discount — what the tax was
   * taken of (Workiz `taxable_amount`, the Tax report's Taxable Amount).
   * Absent on snapshots written before it was kept.
   */
  taxableBase?: number;
  /**
   * Workiz's own `job_amount_due`, on an imported job's snapshot only (the
   * importer writes it; the first repricing here replaces the snapshot and
   * drops it). Read by `unpaid=true` until billing has asserted `amountPaid`.
   */
  amountDue?: number;
}

export interface Deal {
  id: string;
  /**
   * Human-facing Job ID: a random 6-char code of uppercase letters + digits
   * (e.g. "K4T9ZW"), unique across the table. Legacy deals carry their old
   * sequential number coerced to a string ("1042").
   */
  dealNumber: string;
  contactId: string;
  companyId?: string;
  clientType: ClientType;
  /** Start date (YYYY-MM-DD). Paired with the start time in scheduledTimeSlot. */
  scheduledDate?: string;
  /** End date (YYYY-MM-DD); defaults to the start date when the job is same-day. */
  scheduledEndDate?: string;
  /** "HH:MM-HH:MM" — start time and end time. Absent when allDay. */
  scheduledTimeSlot?: string;
  /** An all-day job carries dates only; times are dropped. */
  allDay?: boolean;
  /** Denormalized service-area name for display (auto-resolved from address). */
  serviceArea: string;
  /** Catalog service-area id this deal resolved into; null if outside coverage. */
  serviceAreaId?: string;
  address: Address;
  /** Catalog job-type id. Drives technician eligibility matching. */
  jobTypeId: string;
  /**
   * Workiz "Job name": optional free text naming the job ("Mailbox lock",
   * "Zelli: Junk Removal") — the first field of Job Details on the New Job
   * page and "Job name:" in the job page header. Stored trimmed; absent when
   * the job has none (`null` on update clears it). Imported jobs carry
   * Workiz's `job_name` here.
   */
  jobName?: string;
  /**
   * Fixed pipeline super-status (replaces the legacy 13-stage `stage`). Source of
   * truth for the board/list/reporting. Paired with an optional `subStatusId`.
   */
  superStatus: JobSuperStatus;
  /**
   * @deprecated Legacy 13-stage value, kept only so un-migrated rows still read
   * and historical timeline entries resolve. New writes set `superStatus`.
   */
  stage?: DealStage;
  /** All technicians assigned to this deal (equal peers). Empty = unassigned. */
  assignedTechIds: string[];
  assignedDispatcherId: string;
  /**
   * Per-technician visit order for the day: `techId → position`. A deal shared
   * by several techs can be job #2 for one and #4 for another. Absent entries
   * fall back to scheduled-time order.
   */
  sequences?: Record<string, number>;
  priority: DealPriority;
  /**
   * The business company (brand) this job is done under — drives the
   * invoice/estimate letterhead, payment terms and portal branding. Absent ⇒
   * the default company. Name is denormalized for lists.
   */
  businessProfileId?: string;
  businessProfileName?: string;
  /** Catalog job-source id (where the deal came from). Optional. */
  sourceId?: string;
  /** Catalog external-company id (the partner that referred this job). Optional. */
  externalCompanyId?: string;
  notes?: string;
  internalNotes?: string;
  cancellationReason?: string;
  /** Catalog job-tag ids applied to this deal. */
  tagIds: string[];
  /**
   * Catalog job-sub-status id (a custom colored label under a super-status).
   * Optional and independent of `stage` — a display/reporting label only.
   */
  subStatusId?: string;
  /**
   * The job's single tax rate (Workiz model: one rate per job/invoice, lines
   * only carry a `taxable` flag). Name + percent are snapshotted so editing the
   * catalog rate never silently re-prices an existing job.
   */
  taxRateId?: string;
  taxRateName?: string;
  taxRatePercent?: number;
  /** Where the current tax came from; `manual` blocks service-area re-resolution. */
  taxSource?: DocumentTaxSource;
  /** Job-level discount (shared with the job's invoice). */
  discount?: DocumentDiscount;
  /** Number of line items on the job (kept by the deal service; drives "needs invoice"). */
  itemCount?: number;
  /** Money snapshot — see `DealTotalsSnapshot`. Absent until the job is first priced or backfilled. */
  totals?: DealTotalsSnapshot;
  /** Set by the billing service when the job's invoice exists (=== dealId). */
  invoiceId?: string;
  estimatedTotal?: number;
  actualTotal?: number;
  /**
   * Billing's flag for the job board: `unpaid` | `partial` | `paid`, asserted
   * from the ledger on every payment change. An imported job carries Workiz's
   * own; a job no payment ever touched has none.
   */
  paymentStatus?: string;
  /**
   * Dollars collected on the job — settled payments less refunds — asserted by
   * billing with `paymentStatus`, never added to. Absent until the first
   * payment event (on an imported job: until a payment is taken here).
   * `totals.total` above it is what is still owed (Workiz "Show unpaid jobs").
   */
  amountPaid?: number;
  /** Platinum client Work Order this deal was authorized by (EPIC-9). */
  workOrderId?: string;
  /** Client PO number (required when the company has poRequired). */
  poNumber?: string;
  /** User-defined field answers, keyed by CustomFieldDefinition id (not name). */
  customFields?: Record<string, CustomFieldValue>;

  /* ---------------------------------------------- carried over from Workiz */
  /*
   * A migrated job keeps what a person reads on it. Workiz issued three
   * identifiers per job; `dealNumber` holds the code, and the other two live
   * here. The money a job carried stays out until invoices are built — the
   * importer stores those attributes, nothing reads them yet.
   */

  /** `workiz:job:<id>` — the record this job was migrated from. */
  externalId?: string;
  /** Workiz's own numeric job id. */
  workizId?: number;
  /** Workiz's per-account job serial. Not unique: 835 numbers repeat across 1 682 jobs. */
  jobSerial?: number;
  /** The Workiz service-address (`prop`) this visit was booked against. */
  propId?: string;
  /** IANA zone the visit's times were entered in; absent = the workspace's own. */
  jobTimezone?: string;
  /** This job began as a lead and was converted. */
  converted?: boolean;
  conversionDate?: string;
  /** Calls were linked to this job in Workiz. */
  hasCalls?: boolean;
  /** A technician opened it in Workiz. */
  seen?: boolean;
  /** How many attachments Workiz held — the files themselves arrive with the media stream. */
  filesCount?: number;
  /** Last time Workiz sent this job out, and last time its progress moved. */
  lastSent?: string;
  lastProgress?: string;
  /** Contact details as they stood on the job, which may differ from the client record. */
  emailAddress?: string;
  clientCompanyName?: string;
  /** Numbers the job itself carried, first one primary; extensions keyed by number. */
  phones?: string[];
  phoneExtensions?: Record<string, string>;
  /**
   * Per-job override of the client's display name — set when a client edit on
   * the job is saved with "Just here" instead of being applied to the contact
   * record. Absent = the job shows the contact's own name.
   */
  clientName?: { firstName: string; lastName: string };
  /**
   * The job's own first number, when it is not the client's: set by a first
   * number changed on the job with "This job only", and pinned to the number
   * the job had when the client's profile number changes without it ("This
   * job and the client profile"). Absent = the job shows and dials the
   * client's first number. Deal-service hands it only to a caller with
   * `contacts.view_numbers`, as crm does the client's own numbers.
   */
  clientPhone?: string;
  status: DealStatus;
  createdBy: string;
  /**
   * When the job was closed: the moment it received a Done or Canceled status
   * (or one of their sub-statuses). Cleared if the job is reopened.
   */
  closedAt?: string;
  /**
   * When the job entered its current status (super or sub) — set at creation,
   * re-stamped by every real status move. Drives "time in status" displays.
   */
  statusChangedAt?: string;
  /**
   * Workiz `last_sent` / `sent`: the latest time a dispatcher pressed
   * "Send to tech" on this job (stamped at the click, before the messages
   * go out). Absent = never sent. Per-technician stamps live on the
   * `ASSIGN#<techId>` rows (`sentAt`, `sentVia`, `seenAt`, `deliveries`).
   */
  sentToTechAt?: string;
  /** Channels picked for the latest send — `['sms']`, `['sms', 'email']`, … */
  sentToTechVia?: SendToTechChannel[];
  /** Who pressed "Send to tech" last. */
  sentToTechBy?: string;
  /**
   * Workiz `seen`: the first time any assigned technician opened the job in
   * their app (`POST /deals/:id/seen`). Sticky — a later re-send does not
   * clear it; the per-technician `seenAt` on `ASSIGN#` says who and when.
   */
  seenByTechAt?: string;
  /**
   * Technician flow (Workiz "Confirmed job receipt"): when an assigned
   * technician acknowledged the job from their phone, and who. Absent until
   * somebody taps "Confirm receipt"; dispatch reads it as "the tech has seen
   * this". Optional — rows written before the field existed simply lack it.
   */
  techConfirmedAt?: string;
  techConfirmedBy?: string;
  /**
   * Technician flow (Workiz "Arrived at location"): when the technician
   * tapped "Arrived", who, and — when the phone offered one — the GPS fix
   * at that moment. Absent until then.
   */
  arrivedAt?: string;
  arrivedBy?: string;
  arrivedLocation?: { lat: number; lng: number; accuracy?: number };
  createdAt: string;
  updatedAt: string;
}

/**
 * Where a first number changed on the job goes — the job page's "Apply these
 * changes to…":
 *
 * - `job` — this job only; the client profile keeps its number;
 * - `client` — this job and the client profile; the client's other jobs keep
 *   the number they had (future jobs get the new one);
 * - `open_jobs` — this job, the profile, and the client's open, unpaid jobs
 *   that had the old number; paid and closed jobs never change.
 */
export type ClientPhoneScope = 'job' | 'client' | 'open_jobs';
export const CLIENT_PHONE_SCOPES = ['job', 'client', 'open_jobs'] as const satisfies readonly ClientPhoneScope[];

/** `PUT /deals/:id/client-phone`'s answer: the job as it now stands, and how many other jobs moved. */
export interface ClientPhoneChangeResult {
  deal: Deal;
  otherJobsChanged: number;
}

/**
 * One day of the dashboard's "Jobs By Status" chart: how many jobs were
 * created that day, folded into the three states the chart draws.
 *
 * `open` is everything not yet closed — submitted, in progress, pending and
 * done-pending-approval, which is still awaiting sign-off.
 */
export interface JobsByStatusDay {
  /** `YYYY-MM-DD`. */
  day: string;
  open: number;
  done: number;
  canceled: number;
}

export interface JobsByStatusSeries {
  /** Every day of the window, in order, including the ones with no jobs. */
  days: JobsByStatusDay[];
  /** A walk stopped on its read budget: the counts are floors, not totals. */
  atLeast: boolean;
  /** When this series was computed (ISO) — the nightly snapshot, or a refresh. */
  computedAt?: string;
}

/** An id with the name to print for it. Nothing else — see `JobsListIncluded`. */
export interface PersonName {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * A technician's name as a screen prints it. `workizName` is the whole name
 * Workiz printed for the person ("(2) TX - Daniel Munoz"), present only on
 * someone imported from Workiz and not renamed here since — see
 * `User.workizName`. Print `workizName ?? \`${firstName} ${lastName}\``.
 */
export interface TechnicianName extends PersonName {
  workizName?: string;
}

/**
 * The rows a page of jobs refers to, sent **with** that page instead of
 * fetched again once the browser has read the ids out of it.
 *
 * Why it exists: naming the technicians and clients of fifty jobs used to cost
 * two more round trips, and the one for clients could not even start until the
 * jobs came back — so the grid painted, then filled in names a beat later.
 *
 * **Names only, deliberately.** Numbers and emails are not here and must not
 * be added: crm masks a contact's numbers for a caller without
 * `contacts.view_numbers`, deal-service masks nothing, and a side-load that
 * carried them would hand every holder of `deals.view` exactly what that grant
 * exists to withhold. A screen that shows numbers asks crm for them, which
 * masks per caller as it always has.
 */
export interface JobsListIncluded {
  /** Technicians assigned on this page — with the Workiz name when they have one. */
  technicians: TechnicianName[];
  /** Clients of the jobs on this page. */
  clients: PersonName[];
}

/**
 * The fields of a job on the dispatch map (`GET /deals/map`): every field a
 * `Deal` must have, so a row is an honest `Deal`, plus what the board draws
 * and searches — the pin, the job card and its Sent / Seen stamps, the pin
 * card, a tech's day. deal-service projects its read to exactly these; the
 * web's board is tested against them, so a new field a card starts to draw
 * fails a test until it is added here. Anything else about a job is read by
 * opening it (`GET /deals/:id`).
 */
export const DISPATCH_MAP_JOB_FIELDS = [
  // Required on every `Deal`.
  'id',
  'dealNumber',
  'contactId',
  'clientType',
  'serviceArea',
  'address',
  'jobTypeId',
  'superStatus',
  'assignedTechIds',
  'assignedDispatcherId',
  'priority',
  'tagIds',
  'status',
  'createdBy',
  'createdAt',
  'updatedAt',
  // What the board draws.
  'scheduledDate',
  'scheduledEndDate',
  'scheduledTimeSlot',
  'allDay',
  'sequences',
  'clientName',
  'clientPhone',
  'phones',
  // The job card's Sent / Seen stamps.
  'sentToTechAt',
  'sentToTechVia',
  'seenByTechAt',
] as const satisfies readonly (keyof Deal)[];

/**
 * A client of a job on the dispatch map (`GET /deals/map`): the name, and the
 * numbers and emails exactly as crm shows them to THE CALLER — deal-service
 * asks crm's own `POST /contacts/by-ids` with the caller's token, so a caller
 * without `contacts.view_numbers` gets `phones: []` with `phonesMasked`, as on
 * every crm screen. A client crm would not show the caller at all still comes
 * with its name (crm's internal names route) and no numbers.
 */
export interface DispatchMapClient extends PersonName {
  phones: string[];
  emails: string[];
  phonesMasked?: true;
}

/**
 * What the dispatch map's jobs refer to, sent with them so the board needs no
 * second round trip: the technicians on them (names only, as on the jobs
 * list) and their clients (`DispatchMapClient`).
 */
export interface DispatchMapIncluded {
  technicians: TechnicianName[];
  clients: DispatchMapClient[];
}
