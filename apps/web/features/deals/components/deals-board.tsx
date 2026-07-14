"use client";

import { useMemo } from "react";
import type { Contact, Deal, User } from "@bitcrm/types";
import { DealStage } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { GROUP_ORDER, STAGE_ORDER, groupLabel, stageGroup, stageLabel, stageTone } from "../lib";
import { DealCard } from "./deal-card";

const GROUP_ACCENT: Record<string, string> = {
  submitted: "border-blue-400 text-blue-600 dark:text-blue-400",
  progress: "border-amber-400 text-amber-600 dark:text-amber-400",
  pending: "border-violet-400 text-violet-600 dark:text-violet-400",
  closed: "border-emerald-400 text-emerald-600 dark:text-emerald-400",
  canceled: "border-border text-muted-foreground",
};

export function DealsBoard({
  deals,
  contactMap,
  userMap,
}: {
  deals: Deal[];
  contactMap: Map<string, Contact>;
  userMap: Map<string, User>;
}) {
  const byStage = useMemo(() => {
    const m = new Map<DealStage, Deal[]>();
    for (const s of STAGE_ORDER) m.set(s, []);
    for (const d of deals) m.get(d.stage)?.push(d);
    return m;
  }, [deals]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {GROUP_ORDER.map((group) => {
        const stages = STAGE_ORDER.filter((s) => stageGroup(s) === group);
        return (
          <div key={group} className="flex flex-none gap-3 rounded-xl border bg-muted/30 p-2">
            {stages.map((stage) => {
              const items = byStage.get(stage) ?? [];
              const accent = GROUP_ACCENT[stageTone(stage)];
              return (
                <div key={stage} className="flex w-[220px] flex-none flex-col gap-2">
                  <div className={cn("flex items-center justify-between border-b-2 px-1 pb-1.5", accent)}>
                    <span className="text-xs font-semibold text-foreground">{stageLabel(stage)}</span>
                    <span className="rounded-full bg-background px-1.5 font-mono text-[10px] text-muted-foreground">
                      {items.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.length === 0 ? (
                      <div className="rounded-lg border border-dashed py-4 text-center text-[11px] text-muted-foreground/60">
                        {groupLabel(group)} · empty
                      </div>
                    ) : (
                      items.map((d) => (
                        <DealCard key={d.id} deal={d} contactMap={contactMap} userMap={userMap} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
