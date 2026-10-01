import { type TimelineEventType } from '../enums/timeline-event-type.enum';

export interface TimelineEntry {
  id: string;
  dealId: string;
  /**
   * The job's client at the time of the event. Files the row in the deals
   * table's ContactActivityIndex (GSI10), which is how the client card lists
   * the history of all of the client's jobs; absent on rows written before
   * the index existed until `backfill:contact-index` has run.
   */
  contactId?: string;
  eventType: TimelineEventType;
  actorId: string;
  actorName: string;
  timestamp: string;
  details: Record<string, unknown>;
  note?: string;
}

/**
 * A row of the client card's History (`GET /deals/timeline/by-contact/:id`):
 * a job's event with the job's number for "Job: NU8GUR", or — with no
 * `dealId` at all — a client-level event the Workiz import filed under the
 * client itself (created / deleted).
 */
export interface ContactHistoryEntry extends Omit<TimelineEntry, 'dealId'> {
  dealId?: string;
  dealNumber?: string;
}
