import {
  Archive,
  Banknote,
  Barcode,
  Calculator,
  ChartColumnIncreasing,
  ClipboardCheck,
  Clock3,
  Coins,
  CreditCard,
  FileCheck2,
  FilePlus2,
  Globe,
  Paperclip,
  Percent,
  Phone,
  Receipt,
  Store,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Action, Resource } from "@bitcrm/types";

export interface ReportTile {
  /** Workiz's label, word for word. */
  name: string;
  /** The nearest Lucide glyph to Workiz's line icon for this report. */
  icon: LucideIcon;
  /**
   * Where the report lives in BitCRM. A tile opens only when this page is in
   * the build (see `builtRoutes`); until then it reads "Coming soon". No
   * `href` = nobody is building the report.
   */
  href?: string;
  /**
   * What the report's own page asks for beyond `reports.view` (which the hub
   * itself needs). Workiz leaves out the reports a role may not open; so do we.
   */
  requires?: readonly (readonly [Resource, Action])[];
}

/**
 * The 23 tiles of Workiz's Reports → "Workiz reports" tab, in its on-screen
 * order (row by row, three to a row), with Workiz's labels.
 *
 * Routes and permissions follow the report pages as they are built — on main
 * or in their open PRs (#83–#90, Inventory Usage in `web/inventory-report`).
 * Merging one of those turns its tile on by itself: the tile already points
 * at the page the PR adds.
 */
export const REPORT_TILES: readonly ReportTile[] = [
  { name: "Jobs", icon: Wrench, href: "/reports/jobs" },
  { name: "Performance Pay", icon: Calculator },
  { name: "Sales", icon: Wallet, href: "/reports/sales" },
  { name: "Tips", icon: Wallet, href: "/reports/tips" },
  { name: "Job Statistics", icon: ChartColumnIncreasing, href: "/reports/job-statistics" },
  { name: "Leads Report", icon: Banknote },
  // Workiz's `/root/payments` — the sidebar's Payments page is the report.
  { name: "Payments", icon: CreditCard, href: "/payments", requires: [["payments", "view"]] },
  { name: "Expenses", icon: Coins },
  { name: "Activity", icon: Users, href: "/reports/activity" },
  // Workiz opens these two on the pages of the same name.
  { name: "Estimates", icon: Paperclip, href: "/estimates", requires: [["estimates", "view"]] },
  { name: "Invoices", icon: Receipt, href: "/invoices", requires: [["invoices", "view"]] },
  { name: "Aging invoices", icon: Receipt, href: "/reports/aging-invoices", requires: [["invoices", "view"]] },
  { name: "Timesheets", icon: Clock3, href: "/reports/timesheets" },
  { name: "Items and services", icon: Barcode, href: "/reports/items" },
  { name: "Website requests", icon: Globe },
  { name: "Tax", icon: Percent, href: "/reports/tax", requires: [["financials", "view"]] },
  { name: "Call Tracking", icon: Phone, href: "/reports/call-tracking", requires: [["calls", "view"]] },
  { name: "Inventory Usage", icon: Archive, href: "/reports/inventory-usage" },
  { name: "Franchise Report", icon: Store },
  { name: "Tasks", icon: ClipboardCheck },
  { name: "Equipment", icon: FilePlus2 },
  { name: "Service Plans", icon: FileCheck2 },
  { name: "Commissions (Legacy)", icon: Calculator, href: "/reports/commission", requires: [["commission", "view"]] },
];
