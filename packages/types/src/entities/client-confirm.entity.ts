import type { Address } from './address.entity';
import type { Deal } from './deal.entity';
import type { PortalView } from './portal.entity';

/**
 * The client confirms their appointment — Workiz `{{confirm_link}}` ("To
 * confirm your appointment click here") and its `client_confirmed` flag,
 * logged as "Client Confirmed job". The link is the job's own signed token
 * (`@bitcrm/shared` `client-confirm-link`); the page is the client portal's
 * `/confirm/<token>`; billing's public routes answer it and deal-service
 * decides and records.
 *
 *   open       the visit can be confirmed
 *   confirmed  it already is (for the visit the job has now) — a second tap changes nothing
 *   closed     the job is done, canceled, awaiting approval or deleted — nothing to confirm
 *   expired    the visit is over on the job's clock
 */
export type ClientConfirmState = 'open' | 'confirmed' | 'closed' | 'expired';

/** The visit, as the job keeps it: wall-clock day(s) and slot in the job's own zone. */
export interface ClientConfirmVisit {
  /** `YYYY-MM-DD`; absent = not scheduled yet. */
  scheduledDate?: string;
  scheduledEndDate?: string;
  /** `HH:MM-HH:MM`. */
  scheduledTimeSlot?: string;
  allDay?: boolean;
  /** IANA zone of the visit. */
  timezone?: string;
}

/** deal-service `GET|POST /api/deals/internal/:id/client-confirm` — what billing builds the page from. */
export interface ClientConfirmJob extends ClientConfirmVisit {
  dealId: string;
  dealNumber: string;
  state: ClientConfirmState;
  address?: Address;
  jobType?: string;
  /** The job's company: the page is branded with it. */
  businessProfileId?: string;
  /** When the client confirmed this visit (states `confirmed`). */
  confirmedAt?: string;
  /** POST only: true when this very call recorded the confirmation. */
  recorded?: boolean;
}

/** Body of the internal POST: how the client confirmed, for the job's history. */
export interface ClientConfirmRequest {
  via: Deal['clientConfirmedVia'];
  ip?: string;
  userAgent?: string;
}

/** billing `GET|POST /api/billing/public/confirm/:token` — the portal's confirm page. */
export interface ClientConfirmView {
  state: ClientConfirmState;
  business: PortalView['business'];
  job: ClientConfirmVisit & {
    number: string;
    /** One line. */
    address?: string;
    jobType?: string;
  };
  confirmedAt?: string;
}

/**
 * The visit a confirmation is for: the start day and the slot (or
 * `all-day`); empty for a job with no date. A confirmation stored with a
 * different key was given for a visit the job no longer has.
 */
export function clientConfirmScheduleKey(
  d: Pick<Deal, 'scheduledDate' | 'scheduledTimeSlot' | 'allDay'>,
): string {
  if (!d.scheduledDate) return '';
  return `${d.scheduledDate} ${d.allDay ? 'all-day' : (d.scheduledTimeSlot ?? '')}`.trim();
}

/** The client confirmed the visit the job has NOW (not one it was moved away from). */
export function isClientConfirmationCurrent(
  d: Pick<Deal, 'clientConfirmedAt' | 'clientConfirmedFor' | 'scheduledDate' | 'scheduledTimeSlot' | 'allDay'>,
): boolean {
  return !!d.clientConfirmedAt && (d.clientConfirmedFor ?? '') === clientConfirmScheduleKey(d);
}
