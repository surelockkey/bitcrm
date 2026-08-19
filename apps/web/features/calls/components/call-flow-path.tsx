"use client";

import { Workflow } from "lucide-react";
import { formatCallTime } from "../lib";
import type { CallFlowStep } from "../lib";

const STEP_TITLE: Record<string, string> = {
  say: "Heard a message",
  hours: "Business hours",
  menu: "Voice menu",
  ring: "Rang a group",
  voicemail: "Left a message",
  hangup: "Call ended",
};

/**
 * Where this caller actually went before anybody picked up — the greeting they
 * heard, the key they pressed, which group rang and whether it reached anyone.
 *
 * Worth showing on every call, but it earns its place on the ones nobody
 * answered: those otherwise say only that they were missed, not why.
 */
export function CallFlowPath({
  flowName,
  path,
}: {
  flowName?: string;
  path?: CallFlowStep[];
}) {
  if (!path?.length) return null;

  return (
    <section className="rounded-xl border">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Workflow className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">
          Call flow
          {flowName ? (
            <span className="font-normal text-muted-foreground"> · {flowName}</span>
          ) : null}
        </h3>
      </div>
      <ol className="p-3">
        {path.map((step, i) => (
          <li key={`${step.nodeId}-${step.at}-${i}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
              {i < path.length - 1 ? (
                <span className="w-px flex-1 bg-border" aria-hidden />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 pb-3 last:pb-0">
              <div className="text-sm">
                {STEP_TITLE[step.type] ?? step.type}
              </div>
              {step.detail ? (
                <div className="truncate text-xs text-muted-foreground">
                  {step.detail}
                </div>
              ) : null}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatCallTime(step.at)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
