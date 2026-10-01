import { ReportsPage } from "@/features/reports/components/reports-page";
import { builtRoutes } from "@/features/reports/hub/built-routes";
import { REPORT_TILES } from "@/features/reports/hub/report-tiles";

/**
 * The hub's tiles open only the reports this build has a page for. Read from
 * the app directory while the page is prerendered, so merging a report's page
 * is all it takes to turn its tile on — the hub already knows the route.
 */
export default function Page() {
  const routes = REPORT_TILES.flatMap((t) => (t.href ? [t.href] : []));
  return <ReportsPage built={builtRoutes(routes) ?? routes} />;
}
