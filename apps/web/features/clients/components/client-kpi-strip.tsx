import { cn } from "@/lib/utils";
import { formatMoney } from "@/features/deals/lib";
import type { ClientKpis } from "../client-page";

/**
 * Workiz's four cards above the tabs: Past due, Due, Total revenue,
 * Estimates. The money cards are for roles with `financials.view`; the
 * estimate count is for everyone.
 */
export function ClientKpiStrip({ kpis, money }: { kpis: ClientKpis; money: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      {money ? (
        <>
          <Kpi label="Past due" value={formatMoney(kpis.pastDue)} tone={kpis.pastDue > 0 ? "destructive" : undefined} />
          <Kpi label="Due" value={formatMoney(kpis.due)} />
          <Kpi label="Total revenue" value={formatMoney(kpis.totalRevenue)} />
        </>
      ) : null}
      <Kpi label="Estimates" value={String(kpis.estimates)} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "destructive" }) {
  return (
    <div className={cn("min-w-36 rounded-lg border border-l-4 bg-card px-4 py-2.5", tone === "destructive" ? "border-l-destructive" : "border-l-foreground/60")}>
      <div data-slot="kpi-label" className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className={cn("text-xl font-semibold tabular-nums", tone === "destructive" && "text-destructive")}>{value}</div>
    </div>
  );
}
