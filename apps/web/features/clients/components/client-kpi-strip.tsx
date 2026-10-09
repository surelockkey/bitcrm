import { WzLeftBorderBox, WzTotalsBar } from "@/components/workiz/record-parts";
import { formatMoney } from "@/features/deals/lib";
import type { ClientKpis } from "../client-page";

/**
 * Workiz's totals over the tabs (`client-module__totals`): PAST DUE (always
 * red), DUE, TOTAL REVENUE, ESTIMATES. The money is for roles with
 * `financials.view`; the estimate count is for everyone.
 *
 * Workiz prints TOTAL REVENUE without thousands separators ("$108989.43")
 * while DUE has them; ours groups all three alike.
 */
export function ClientKpiStrip({ kpis, money }: { kpis: ClientKpis; money: boolean }) {
  return (
    <WzTotalsBar aria-label="Client totals">
      {money ? (
        <>
          <WzLeftBorderBox label="Past due" value={formatMoney(kpis.pastDue)} tone="danger" />
          <WzLeftBorderBox label="Due" value={formatMoney(kpis.due)} />
          <WzLeftBorderBox label="Total revenue" value={formatMoney(kpis.totalRevenue)} />
        </>
      ) : null}
      <WzLeftBorderBox label="Estimates" value={String(kpis.estimates)} />
    </WzTotalsBar>
  );
}
