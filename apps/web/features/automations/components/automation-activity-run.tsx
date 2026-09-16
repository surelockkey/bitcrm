"use client";

import { useState } from "react";
import Link from "next/link";
import type { AutomationRun, AutomationRunAction, AutomationRunOutcome } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OUTCOME_LABEL, formatFiredAt, outcomeTone } from "../lib";

const TONE_CLASS: Record<string, string> = {
  ok: "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warn: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  bad: "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  muted: "",
};

/** How the firing ended — the same badge in the rule's log and in the feed. */
export function RunOutcomeBadge({ outcome }: { outcome: AutomationRunOutcome }) {
  return (
    <Badge variant="outline" className={TONE_CLASS[outcomeTone(outcome)]}>
      {OUTCOME_LABEL[outcome] ?? outcome}
    </Badge>
  );
}

/** What the engine did with one action of the rule, in the reader's words. */
const ACTION_LABEL: Record<string, string> = {
  send_sms: "Text message",
  send_email: "Email",
  send_in_app: "In-app message",
  webhook: "Webhook",
  add_tag: "Job tag",
  change_sub_status: "Job status",
};

/**
 * `action.to` holds the resolved recipient ("Ann (tech)"); when nothing
 * resolved the engine records the rule's recipient kind instead, and that
 * is the one case the reader would otherwise see a key.
 */
const RECIPIENT_WORD: Record<string, string> = {
  client: "the client",
  assigned_techs: "the assigned techs",
  dispatcher: "the dispatcher",
  users: "the chosen users",
  role: "everyone in the role",
  number: "the number in the rule",
};

const ACTION_OUTCOME_LABEL: Record<string, string> = {
  sent: "Sent",
  duplicate: "Already sent",
  skipped: "Not sent",
  failed: "Failed",
  dry_run: "Would send",
  unsupported: "Not supported here",
};

export function actionOutcomeLabel(outcome: string): string {
  return ACTION_OUTCOME_LABEL[outcome] ?? outcome.replace(/_/g, " ");
}

function actionLabel(action: AutomationRunAction): string {
  return ACTION_LABEL[action.type] ?? String(action.type).replace(/_/g, " ");
}

function recipientWord(to: string): string {
  return RECIPIENT_WORD[to] ?? to;
}

/** What one firing was about, as a phrase and — where there is one — a link. */
export interface RunEntityView {
  text: string;
  href?: string;
  /** Spoken name of the link, since the visible text is a phrase. */
  label?: string;
}

/** A uuid is never read out loud; eight characters are enough to tell rows apart. */
const shortId = (id: string) => (id.length > 10 ? id.slice(0, 8) : id);

/**
 * `deal:<id>` / `call:<sid>` / `message:<id>` — the key the engine files a
 * firing under (§4.6). A job becomes a link to that job; a call and a message
 * are said in words, because their ids mean nothing to the person reading.
 */
export function runEntityView(run: AutomationRun): RunEntityView {
  const raw = run.entity ?? "";
  const colon = raw.indexOf(":");
  const kind = colon === -1 ? raw : raw.slice(0, colon);
  const id = colon === -1 ? "" : raw.slice(colon + 1);

  if (kind === "deal") {
    // `deal:unknown` is what the engine writes when the event named no job —
    // a real state of the log, not a bug, so it gets words rather than a dead link.
    if (!id || id === "unknown") return { text: "A job the event did not name" };
    return { text: `Job ${shortId(id)}`, href: `/deals/${id}`, label: `Open job ${id}` };
  }
  if (kind === "call" && id) {
    return { text: "A phone call", href: `/calls/${id}`, label: `Open the call ${id}` };
  }
  // The thread of an incoming message is not the thread the rule answered in
  // (a rule may text a technician instead), so the link sits on the action.
  if (kind === "message" && id) return { text: "An incoming message" };
  return { text: raw || "Something the log did not name" };
}

/** The entity of a firing, plus the job it happened on when that is a second thing. */
export function RunEntity({ run }: { run: AutomationRun }) {
  const entity = runEntityView(run);
  const dealHref = `/deals/${run.dealId}`;
  const alsoDeal = !!run.dealId && entity.href !== dealHref;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {entity.href ? (
        <Link href={entity.href} aria-label={entity.label} className="text-primary hover:underline">
          {entity.text}
        </Link>
      ) : (
        <span>{entity.text}</span>
      )}
      {alsoDeal ? (
        <>
          <span aria-hidden>·</span>
          <Link
            href={dealHref}
            aria-label={`Open job ${run.dealId}`}
            className="text-primary hover:underline"
          >
            Job {shortId(run.dealId as string)}
          </Link>
        </>
      ) : null}
    </span>
  );
}

/** A body long enough that showing it whole would bury the rest of the row. */
const isLong = (body: string) => body.length > 110 || body.includes("\n");

function RunActionRow({ action }: { action: AutomationRunAction }) {
  const [open, setOpen] = useState(false);
  const body = action.body?.trim();
  const long = !!body && isLong(body);
  const to = action.to ? recipientWord(action.to) : undefined;

  return (
    <li className="rounded-md border bg-muted/30 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-medium">{actionLabel(action)}</span>
          {to ? <span className="text-muted-foreground"> to {to}</span> : null}
        </span>
        <Badge variant="outline" className="shrink-0">
          {actionOutcomeLabel(action.outcome)}
        </Badge>
      </div>

      {body ? (
        <>
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap text-muted-foreground",
              long && !open && "line-clamp-2",
            )}
          >
            {body}
          </p>
          {long ? (
            <button
              type="button"
              className="mt-1 text-primary hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Show less" : "Show the whole message"}
            </button>
          ) : null}
        </>
      ) : null}

      {action.error ? <p className="mt-1 text-muted-foreground">{action.error}</p> : null}

      {action.conversationId ? (
        <p className="mt-1">
          <Link href={`/messages?c=${action.conversationId}`} className="text-primary hover:underline">
            Open the thread
          </Link>
        </p>
      ) : null}
    </li>
  );
}

/**
 * What the firing actually did: every action with its own outcome, the
 * message as it went out and who it went to — and, for a firing that did
 * nothing, the reason the engine recorded (§4.6, plan item 21).
 */
export function RunActions({ run }: { run: AutomationRun }) {
  if (!run.actions?.length) {
    const waiting = run.outcome === "scheduled" && run.dueAt;
    return (
      <p className="mt-1 text-xs text-muted-foreground" data-testid="run-nothing">
        {waiting ? `Held until ${formatFiredAt(run.dueAt as string)}` : "Nothing was sent"}
        {run.reason ? ` — ${run.reason}` : "."}
      </p>
    );
  }

  return (
    <ul className="mt-1.5 space-y-1.5" data-testid="run-actions">
      {run.actions.map((action, i) => (
        <RunActionRow key={`${action.type}-${i}`} action={action} />
      ))}
      {/* A firing can both send and record why the rest of it did not. */}
      {run.reason ? <li className="text-xs text-muted-foreground">{run.reason}</li> : null}
    </ul>
  );
}
