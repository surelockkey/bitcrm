import {
  Archive,
  Barcode,
  Calculator,
  ChartNoAxesCombined,
  CreditCard,
  Globe,
  Percent,
  Phone,
  Receipt,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Action, Resource } from "@bitcrm/types";
import { HammerWrench, UprightPaperclip } from "./report-icons";

export interface ReportTile {
  /** Workiz's label, word for word. */
  name: string;
  /**
   * The nearest Lucide glyph to the Linearicons one on Workiz's card
   * (`lnr-hammer-wrench`, `lnr-chart-growth`, … — rep_hub_wz_01_default).
   */
  icon: LucideIcon;
  /**
   * Where the report lives in BitCRM. A card shows only while this page is in
   * the build (see `builtRoutes`). No `href` = nobody is building the report.
   */
  href?: string;
  /**
   * What the report's own page asks for beyond `reports.view` (which the hub
   * itself needs). Workiz leaves out the reports a role may not open; so do we.
   */
  requires?: readonly (readonly [Resource, Action])[];
}

/**
 * The 14 Workiz reports the business kept (struck out on 2026-09-25 and
 * confirmed on 2026-10-01), in the order Workiz's hub lays them out row by
 * row once the dropped ones are taken out. Performance Pay, Sales, Tips,
 * Leads, Expenses, Timesheets, Tasks, Equipment and Service Plans are not
 * coming back.
 *
 * The hub shows a card only for a report whose page is in the build: merging
 * a report's page (Inventory Usage is the one still to come) turns its card
 * on by itself.
 */
export const REPORT_TILES: readonly ReportTile[] = [
  { name: "Jobs", icon: HammerWrench, href: "/reports/jobs" },
  { name: "Job Statistics", icon: ChartNoAxesCombined, href: "/reports/job-statistics" },
  // Workiz's `/root/payments`: reached from this hub, not from the sidebar.
  { name: "Payments", icon: CreditCard, href: "/reports/payments", requires: [["payments", "view"]] },
  { name: "Activity", icon: Users, href: "/reports/activity" },
  // Workiz's cards open its Estimates and Invoices list pages (/root/estimates,
  // /root/invoices — rep_hub_wz_07_*_target), the ones its sidebar opens.
  { name: "Estimates", icon: UprightPaperclip, href: "/estimates", requires: [["estimates", "view"]] },
  { name: "Invoices", icon: Receipt, href: "/invoices", requires: [["invoices", "view"]] },
  { name: "Aging invoices", icon: Receipt, href: "/reports/aging-invoices", requires: [["invoices", "view"]] },
  { name: "Items and services", icon: Barcode, href: "/reports/items" },
  { name: "Website requests", icon: Globe },
  { name: "Tax", icon: Percent, href: "/reports/tax", requires: [["financials", "view"]] },
  { name: "Call Tracking", icon: Phone, href: "/reports/call-tracking", requires: [["calls", "view"]] },
  { name: "Inventory Usage", icon: Archive, href: "/reports/inventory-usage" },
  { name: "Franchise Report", icon: Store },
  { name: "Commissions (Legacy)", icon: Calculator, href: "/reports/commission", requires: [["commission", "view"]] },
];

/**
 * The cards the hub draws: the kept reports that have a page in this build
 * (`built`; left out = the server couldn't tell, so every route counts) and
 * that the viewer may open — in Workiz's order. A report without a page gets
 * no card at all: no dead tiles.
 */
export function hubTiles({
  built,
  denied,
}: {
  built?: readonly string[];
  denied: (resource: Resource, action: Action) => boolean;
}): ReportTile[] {
  return REPORT_TILES.filter(
    (t) =>
      t.href !== undefined &&
      (built ? built.includes(t.href) : true) &&
      !(t.requires ?? []).some(([resource, action]) => denied(resource, action)),
  );
}
