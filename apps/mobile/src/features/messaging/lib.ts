import type { InfiniteData } from '@tanstack/react-query';
import { ApiError } from '../../lib/api/errors';
import type { Page } from '../../lib/api/http';
import type { QueueRecord, QueueState } from '../../lib/queue/types';
import type { ChatPayload } from '../queue/transport';
import type { FeedMessage, TeamThread } from './api';

/**
 * Turning the thread with the office into something a technician can read.
 *
 * Every rule that decides what a line says, which side it sits on and which
 * day it belongs to is a pure function here rather than a branch inside the
 * screen — the same reason `features/queue/lib.ts` exists. The wording and the
 * grouping are the web Inbox's, verbatim where it matters
 * (`apps/web/features/messaging/lib.ts`), because the office and the van have
 * to be reading one conversation, not two.
 */

/* --------------------------------------------------------------- the thread */

/**
 * The technician's own thread among the staff threads the server returned.
 *
 * A technician's `team_chat` scope is `assigned_only`, so the list is exactly
 * one row — but a dispatcher signing into the app has the whole team's, and
 * "the first row" would then be somebody else's conversation. Matched by
 * `partyId`; the single-row fallback covers only the case where the phone does
 * not yet know who is signed in.
 */
export function officeThreadOf(
  threads: readonly TeamThread[],
  meId: string | undefined,
): TeamThread | undefined {
  const own = threads.find(
    (t) => t.kind === 'team' && t.partyKind === 'user' && t.partyId === meId,
  );
  if (own) return own;
  if (!meId && threads.length === 1) return threads[0];
  return undefined;
}

/**
 * Whose line this is.
 *
 * Not `direction`: on an employee's own thread the server stamps **their**
 * lines `inbound` (they are the party — `send.service.ts:744,755`) and the
 * office's `outbound`, so aligning by direction would put the technician's own
 * words on the left. What identifies a line is its author. Imported Workiz
 * history carries no author id at all, and there `inbound` is the technician's
 * own side of the same thread.
 */
export function isMine(
  message: Pick<FeedMessage, 'sentByUserId' | 'direction'>,
  meId: string | undefined,
): boolean {
  if (message.sentByUserId) return message.sentByUserId === meId;
  return message.direction === 'inbound';
}

/** The name on a bubble: "You", the office person who wrote it, or "Office". */
export function senderName(message: FeedMessage, mine: boolean): string {
  if (mine) return 'You';
  if (message.origin === 'automation') return 'Automation';
  return message.sentByName ?? 'Office';
}

/**
 * What a bubble says.
 *
 * A line can carry files and no words — 0.9% of Workiz's in-app messages had
 * an attachment (`WORKIZ_MOBILE_APP.md` §1.5), and this app cannot show one
 * yet. Naming it is the honest answer; an empty bubble reads as a message that
 * arrived broken.
 */
export function bodyOf(message: Pick<FeedMessage, 'body' | 'attachments'>): string {
  if (message.body) return message.body;
  const files = message.attachments?.length ?? 0;
  if (!files) return '';
  return files === 1
    ? '(1 attachment — open BitCRM in the browser to see it)'
    : `(${files} attachments — open BitCRM in the browser to see them)`;
}

/** Sort key of a message (`MSG#<createdAt>#<id>`) — what the read marker stores. */
export const messageSk = (m: Pick<FeedMessage, 'createdAt' | 'id'>): string =>
  `MSG#${m.createdAt}#${m.id}`;

/* ------------------------------------------------------------------- time */

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/**
 * The day chip, spelled as the web Inbox spells it — which is how Workiz
 * spells it, comma and all: "Tuesday,September 15 2026"
 * (`apps/web/features/messaging/lib.ts:443-449`). Today and Yesterday are
 * named rather than dated: on a phone, "Today" is the answer to the question
 * a technician is actually asking.
 */
export function formatDayChip(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday},${month} ${d.getDate()} ${d.getFullYear()}`;
}

/** "12:10 PM". The date is on the day chip above, so a bubble only needs the clock. */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/* ------------------------------------------------------------- the pending */

/** A line the technician wrote that has not reached the office yet. */
export interface PendingLine {
  /** The queue row's id — retry and discard are addressed by it. */
  id: string;
  body: string;
  createdAt: number;
  state: QueueState;
  lastError: string | null;
}

/**
 * The chat lines still in the outbox, oldest first.
 *
 * A row that has landed (`done`) is dropped: the server's own copy is in the
 * feed, or is one poll away, and showing both would read as a message sent
 * twice. A row whose payload cannot be parsed is dropped rather than drawn
 * empty — it is still on the Queue screen, which is where an unreadable row
 * belongs.
 */
export function pendingLines(records: readonly QueueRecord[]): PendingLine[] {
  const lines: PendingLine[] = [];
  for (const record of records) {
    if (record.queue !== 'outbox' || record.kind !== 'chat') continue;
    if (record.state === 'done') continue;
    try {
      const payload = JSON.parse(record.payload) as ChatPayload;
      if (!payload?.body) continue;
      lines.push({
        id: record.id,
        body: payload.body,
        createdAt: record.createdAt,
        state: record.state,
        lastError: record.lastError,
      });
    } catch {
      continue;
    }
  }
  return lines.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** What the words under a pending bubble say. */
export function pendingStatusText(line: PendingLine): string {
  switch (line.state) {
    case 'sending':
      return 'Sending…';
    case 'failed':
      return `Not sent${line.lastError ? ` · ${line.lastError}` : ''}`;
    case 'unknown':
      return line.lastError ?? 'The app closed while this was being sent.';
    default:
      return 'Waiting for a signal';
  }
}

/* ---------------------------------------------------------------- the feed */

/** Newest first, one entry per id — pages overlap after a refetch. */
export function flattenFeed(pages: readonly { data: FeedMessage[] }[] | undefined): FeedMessage[] {
  const seen = new Set<string>();
  const out: FeedMessage[] = [];
  for (const page of pages ?? []) {
    for (const m of page.data) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** The shape react-query keeps an infinite feed in. */
export type FeedPages = InfiniteData<Page<FeedMessage>, string | undefined>;

/**
 * The feed with a line that has just reached the office folded into it.
 *
 * The queue row is dropped from the thread the moment it is `done` — showing
 * both it and the server's copy would read as a message sent twice — so
 * something has to take its place in the same render, or the technician
 * watches their own words disappear for as long as a refetch takes, and for
 * good if the signal drops in between. A phone that has never loaded the feed
 * gets a one-page one: `hasNextPage` is then false until the refetch behind
 * this answers, which is better than an empty thread.
 */
export function feedWithLandedLine(
  previous: FeedPages | undefined,
  message: FeedMessage,
): FeedPages {
  if (!previous?.pages.length) {
    return {
      pages: [{ data: [message], pagination: {} }],
      pageParams: [undefined],
    };
  }
  const known = previous.pages.some((page) => page.data.some((m) => m.id === message.id));
  if (known) return previous;
  const [newest, ...older] = previous.pages;
  return {
    ...previous,
    // Newest first, as the API hands the page over; `flattenFeed` sorts anyway.
    pages: [{ ...newest!, data: [message, ...newest!.data] }, ...older],
  };
}

/** One line as the screen draws it. */
export interface FeedRow {
  key: string;
  /** Right-hand side: the technician's own words. */
  mine: boolean;
  name: string;
  body: string;
  /** "12:10 PM", or empty for a line that has not been stamped by the server. */
  time: string;
  /** The queue's own words, while a line is still on the phone. */
  status?: string;
  failed?: boolean;
  /** The outbox row, when this line can still be retried. */
  queueId?: string;
  /** Drawn above this row, when the day changes here. */
  dayLabel?: string;
}

/**
 * The rows of the thread, **newest first** — the order an inverted list wants,
 * where index 0 is the bubble at the bottom of the screen.
 *
 * Queued lines come first because they are the newest thing the technician
 * did: a message written in a basement sits under the last one the office
 * sent, exactly where it will be once it lands. The day chip is attached to
 * the row whose older neighbour belongs to another day, so in an inverted list
 * it is drawn immediately above the first line of that day.
 */
export function feedRows(
  messages: readonly FeedMessage[],
  pending: readonly PendingLine[],
  meId: string | undefined,
  now = new Date(),
): FeedRow[] {
  const rows: FeedRow[] = [];
  const stamps: string[] = [];

  for (let i = pending.length - 1; i >= 0; i--) {
    const line = pending[i]!;
    const iso = new Date(line.createdAt).toISOString();
    rows.push({
      key: `pending:${line.id}`,
      mine: true,
      name: 'You',
      body: line.body,
      time: formatMessageTime(iso),
      status: pendingStatusText(line),
      failed: line.state === 'failed' || line.state === 'unknown',
      queueId: line.id,
    });
    stamps.push(iso);
  }

  for (const message of messages) {
    const mine = isMine(message, meId);
    rows.push({
      key: message.id,
      mine,
      name: senderName(message, mine),
      body: bodyOf(message),
      time: formatMessageTime(message.createdAt),
    });
    stamps.push(message.createdAt);
  }

  for (let i = 0; i < rows.length; i++) {
    const day = dayOf(stamps[i]!);
    const older = i + 1 < rows.length ? dayOf(stamps[i + 1]!) : undefined;
    if (day !== older) rows[i]!.dayLabel = formatDayChip(stamps[i]!, now);
  }
  return rows;
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : dayKey(d);
}

/* -------------------------------------------------------------- the badge */

/**
 * What goes on the tab: how many **employee threads** have something unread,
 * which for a technician is their own thread and nothing else. Group threads
 * are counted separately by the server and are left out on purpose — the tab
 * cannot open one, and a badge for a conversation nobody can reach is a
 * technician tapping around looking for it.
 *
 * `undefined` rather than 0 — react-navigation draws a badge for any defined
 * value, and an empty circle over "Messages" reads as an unread message that
 * is not there (`features/queue/lib.ts:150-155`).
 */
export function unreadBadge(unread: number | undefined): string | undefined {
  if (!unread || unread < 1) return undefined;
  return unread > 9 ? '9+' : String(unread);
}

/* -------------------------------------------------------------- the errors */

/**
 * Why the thread would not load, in words a technician can act on. Everything
 * the phone does with a message is queued, so this only ever describes a read.
 */
export function describeReadError(error: unknown): { title: string; body: string } {
  if (error instanceof ApiError && error.status === 0) {
    return {
      title: 'No signal',
      body: 'Messages will appear as soon as the phone has a connection. Anything you write now is sent when it does.',
    };
  }
  if (error instanceof ApiError && error.status === 403) {
    return {
      title: 'Not your conversation',
      body: 'This account cannot open the office thread. Ask dispatch to check your role.',
    };
  }
  return {
    title: 'Could not open your messages',
    body:
      error instanceof ApiError
        ? error.message
        : 'Something went wrong on the way to the server.',
  };
}
