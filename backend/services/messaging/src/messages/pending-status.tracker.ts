import { Injectable } from '@nestjs/common';
import { type MessageKey } from './messages.repository';

/** One outbound line handed to the provider whose final status is still to come. */
export interface PendingStatusEntry {
  key: MessageKey;
  /** When the worker handed it over (epoch ms). */
  trackedAt: number;
  /** Not checked before this (epoch ms) — the poller backs off on a line that stays `sent`. */
  nextAt: number;
  /** How many times the poller has asked the provider about it. */
  attempts: number;
}

/** Most lines remembered per process; past it the oldest is forgotten first. */
export const PENDING_STATUS_CAPACITY = 1000;

export const pendingStatusId = (key: MessageKey): string => `${key.conversationId}|${key.createdAt}|${key.messageId}`;

/**
 * The outbound lines this process handed to Twilio and has not seen a
 * terminal status for — what the status-sync poller (`reconcile/`) walks
 * when status callbacks cannot reach us. In-memory and per process on
 * purpose: there is no global message index to list `sending` lines from
 * (design §3.4), and a line another instance sent is that instance's to
 * follow up on. Bounded, insertion-ordered, nothing is ever awaited here.
 */
@Injectable()
export class PendingStatusTracker {
  private readonly entries = new Map<string, PendingStatusEntry>();

  /** Remember a line; re-tracking an existing one resets nothing. */
  track(key: MessageKey, at: number = Date.now()): void {
    const id = pendingStatusId(key);
    if (this.entries.has(id)) return;
    while (this.entries.size >= PENDING_STATUS_CAPACITY) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(id, { key: { ...key }, trackedAt: at, nextAt: at, attempts: 0 });
  }

  /** Lines at least `minAgeMs` old whose back-off has elapsed, oldest first. */
  due(now: number, minAgeMs = 0): PendingStatusEntry[] {
    const out: PendingStatusEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.trackedAt + minAgeMs <= now && entry.nextAt <= now) out.push(entry);
    }
    return out;
  }

  /** The provider had nothing final yet: ask again no earlier than `nextAt`. */
  defer(key: MessageKey, nextAt: number): void {
    const entry = this.entries.get(pendingStatusId(key));
    if (!entry) return;
    entry.attempts += 1;
    entry.nextAt = nextAt;
  }

  forget(key: MessageKey): void {
    this.entries.delete(pendingStatusId(key));
  }

  has(key: MessageKey): boolean {
    return this.entries.has(pendingStatusId(key));
  }

  get size(): number {
    return this.entries.size;
  }
}
