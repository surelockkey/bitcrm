"use client";

import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useOnboarding } from "../hooks";
import { onboardingPct } from "../lib";

/**
 * Whether this person can be sent on a job yet, and what is missing.
 *
 * It was half of an Overview tab, beside an "At a glance" card repeating
 * status, phone, home base and labor cost. Those four now sit in the form on
 * this same page, a screen above; a second copy of a field is a field that can
 * disagree with itself, so only the checklist — which nothing else says — is
 * kept, along with the van link that was the card's one other reason to exist.
 */
export function OnboardingSection({ technicianId }: { technicianId: string }) {
  const { data: onboarding, isLoading } = useOnboarding(technicianId);

  if (isLoading) return <Skeleton className="h-44 w-full" />;

  const pct = onboarding ? onboardingPct(onboarding) : 0;

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Onboarding</h3>
        <span className="text-sm text-muted-foreground">
          {onboarding?.completedSteps ?? 0} of {onboarding?.totalSteps ?? 3}
        </span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
      </div>
      <CheckRow done={!!onboarding?.checklist.profileComplete} label="Profile complete" hint="phone · address · photo" />
      <CheckRow done={!!onboarding?.checklist.assignmentsApproved} label="Assignments approved" hint="≥1 job type + area" />
      <CheckRow done={!!onboarding?.checklist.commissionSet} label="Commission set" last />
      <Link
        href="/inventory/containers"
        className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        Van inventory <ArrowUpRight className="size-3.5" />
      </Link>
    </section>
  );
}

function CheckRow({
  done,
  label,
  hint,
  last,
}: {
  done: boolean;
  label: string;
  hint?: string;
  last?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 py-2.5", !last && "border-b")}>
      <span
        className={cn(
          "flex size-5 flex-none items-center justify-center rounded-full",
          done ? "bg-green-500/15 text-green-600 dark:text-green-500" : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <span className="flex-1 text-sm">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
