/**
 * Canonical contract for events published on the `call-events` SNS topic.
 * Publisher: telephony-service. Consumers: none yet (reporting/CRM activity
 * are the expected first subscribers).
 */
export const CALL_EVENT_TOPIC = 'call-events' as const;

export const CallEventType = {
  /** The call was answered (both parties connected). */
  CALL_STARTED: 'call.started',
  /** The call reached a terminal status (completed/busy/no-answer/failed/canceled). */
  CALL_COMPLETED: 'call.completed',
  /** The conference recording finished processing and is playable. */
  CALL_RECORDING_READY: 'call.recording_ready',
} as const;

export type CallEventType = (typeof CallEventType)[keyof typeof CallEventType];

// --- Payloads ---

export interface CallStartedEvent {
  callSid: string;
  direction?: 'inbound' | 'outbound';
  from?: string;
  to?: string;
  agentId?: string;
  answeredAt: string;
}

export interface CallCompletedEvent {
  callSid: string;
  direction?: 'inbound' | 'outbound';
  from?: string;
  to?: string;
  agentId?: string;
  status: string;
  durationSeconds?: number;
  startedAt: string;
  endedAt?: string;
}

export interface CallRecordingReadyEvent {
  callSid: string;
  recordingSid: string;
  recordingDurationSeconds?: number;
}
