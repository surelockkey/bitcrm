"use client";

import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useOnboarding, useProfile } from "../hooks";
import { formatMoney, onboardingPct, statusLabel } from "../lib";
import { TechnicianStatusBadge } from "./technician-status-badge";

export function OverviewTab({ technicianId }: { technicianId: string }) {
  const { data: onboarding, isLoading: obLoading } = useOnboarding(technicianId);
  const { data: profile, isLoading: pLoading } = useProfile(technicianId);

  if (obLoading || pLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  const pct = onboarding ? onboardingPct(onboarding) : 0;
  const address = profile?.homeAddress;
  const addrLine = address ? `${address.city}, ${address.state}` : "—";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
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
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">At a glance</h3>
        <dl className="text-sm">
          <Row label="Status" value={profile ? <TechnicianStatusBadge status={profile.status} /> : statusLabel("pending")} />
          <Row label="Phone" value={profile?.phone || "—"} />
          <Row label="Home base" value={addrLine} />
          <Row label="Labor cost" value={profile?.laborCostPerHour != null ? `${formatMoney(profile.laborCostPerHour)} / hr` : "—"} />
          <Row
            label="Van inventory"
            value={
              <Link href="/inventory/containers" className="inline-flex items-center gap-1">
                Container <ArrowUpRight className="size-3.5" />
              </Link>
            }
            last
          />
        </dl>
      </section>
    </div>
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

function Row({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2", !last && "border-b")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
