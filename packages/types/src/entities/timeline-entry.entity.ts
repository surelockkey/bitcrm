import { type TimelineEventType } from '../enums/timeline-event-type.enum';

export interface TimelineEntry {
  id: string;
  dealId: string;
  eventType: TimelineEventType;
  actorId: string;
  actorName: string;
  timestamp: string;
  details: Record<string, unknown>;
  note?: string;
}
