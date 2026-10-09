"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useOnboarding } from "../hooks";

/**
 * Whether this person can be sent on a job yet, and what is missing — ours,
 * not Workiz's, drawn in the user page's idiom: 14px ink rows, a green tick
 * (Workiz's #3acf7d) for a step done, a #9ea6aa ring for one to do, and the
 * van's stock as a 13px blue link, as Workiz's "here" link reads.
 */
export function OnboardingSection({ technicianId }: { technicianId: string }) {
  const { data: onboarding, isLoading } = useOnboarding(technicianId);

  if (isLoading) return <Skeleton className="h-28 w-full" />;

  return (
    <div data-testid="onboarding" className="space-y-2.5">
      <p className="text-[13px] leading-[19px] tracking-[0.4px] text-wz-outline-label">
        Onboarding: {onboarding?.completedSteps ?? 0} of {onboarding?.totalSteps ?? 3} steps done
      </p>
      <ul className="space-y-2">
        <CheckRow done={!!onboarding?.checklist.profileComplete} label="Profile complete" hint="phone · address · photo" />
        <CheckRow done={!!onboarding?.checklist.assignmentsApproved} label="Assignments approved" hint="a job type and a service area" />
        <CheckRow done={!!onboarding?.checklist.commissionSet} label="Commission set" />
      </ul>
      <p className="text-[13px] leading-[19px] tracking-[0.4px] text-foreground">
        Their van&apos;s stock is under{" "}
        <Link href="/inventory/containers" className="font-semibold text-brand hover:underline">
          Inventory
        </Link>
      </p>
    </div>
  );
}

function CheckRow({ done, label, hint }: { done: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm leading-[21px] tracking-[0.4px] text-foreground">
      <span
        aria-hidden
        className={cn(
          "grid size-[18px] shrink-0 place-items-center rounded-full",
          done ? "bg-wz-tag-success text-white" : "border border-wz-outline",
        )}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span>
        {label}
        <span className="sr-only">{done ? " — done" : " — to do"}</span>
      </span>
      {hint ? <span className="text-xs text-wz-outline-label">{hint}</span> : null}
    </li>
  );
}
