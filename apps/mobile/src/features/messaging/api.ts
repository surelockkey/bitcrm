import * as Crypto from 'expo-crypto';
import { http } from '../../lib/api/http';

/**
 * A fresh idempotency key per tap.
 *
 * Without one the server dedupes the automatic texts on
 * (rule, job, technician, 15-minute bucket) — which ignores the minutes. A
 * technician who says "15 minutes" and then, five minutes later, "45 minutes"
 * would get a 202 for the second and the client would never see it
 * (docs/ARCHITECTURE.md §1.4). So every send mints its own.
 */
export function newClientMessageId(): string {
  return Crypto.randomUUID();
}

export interface OnMyWayBody {
  dealId: string;
  /** 1…600. Omitted, the template says "on the way" without a time. */
  etaMinutes?: number;
  clientMessageId: string;
}

export interface RunningLateBody {
  dealId: string;
  /** 1…600. Required by the server for this one. */
  minutes: number;
  clientMessageId: string;
}

/**
 * "On my way" — the workspace's own wording, rendered and sent server-side, so
 * the phone never composes a customer-facing text.
 */
export const sendOnMyWay = (body: OnMyWayBody): Promise<unknown> =>
  http.post('/messaging/automations/on-my-way', body);

/** "Running late", with how many minutes. */
export const sendRunningLate = (body: RunningLateBody): Promise<unknown> =>
  http.post('/messaging/automations/late', body);
