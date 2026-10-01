import {
  Archive,
  Barcode,
  Calculator,
  ChartColumnIncreasing,
  CreditCard,
  Globe,
  Paperclip,
  Percent,
  Phone,
  Receipt,
  Store,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Action, Resource } from "@bitcrm/types";

export interface ReportTile {
  /** Workiz's label, word for word. */
  name: string;
  /** One line on what the report answers — the hub shows it under the name. */
  description: string;
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
 * The 14 Workiz reports the business kept (struck out on 2026-09-25 and
 * confirmed on 2026-10-01), in Workiz's on-screen order. Performance Pay,
 * Sales, Tips, Leads, Expenses, Timesheets, Tasks, Equipment and Service
 * Plans are not coming back.
 *
 * Routes and permissions follow the report pages as they are built — on main
 * or in their open PRs. Merging one of those turns its tile on by itself: the
 * tile already points at the page the PR adds.
 */
export const REPORT_TILES: readonly ReportTile[] = [
  { name: "Jobs", description: "Every job in a period, with its status, team and totals.", icon: Wrench, href: "/reports/jobs" },
  {
    name: "Job Statistics",
    description: "Jobs, sales and profit by day, source or technician.",
    icon: ChartColumnIncreasing,
    href: "/reports/job-statistics",
  },
  // Workiz's `/root/payments` — the sidebar's Payments page is the report.
  {
    name: "Payments",
    description: "Payments taken, by method and by who took them.",
    icon: CreditCard,
    href: "/payments",
    requires: [["payments", "view"]],
  },
  { name: "Activity", description: "What each user did in BitCRM, and when.", icon: Users, href: "/reports/activity" },
  // Workiz opens these two on the pages of the same name.
  {
    name: "Estimates",
    description: "Estimates sent, approved and still waiting.",
    icon: Paperclip,
    href: "/estimates",
    requires: [["estimates", "view"]],
  },
  {
    name: "Invoices",
    description: "Invoices issued, paid and outstanding.",
    icon: Receipt,
    href: "/invoices",
    requires: [["invoices", "view"]],
  },
  {
    name: "Aging invoices",
    description: "Unpaid invoices by how long they've been overdue.",
    icon: Receipt,
    href: "/reports/aging-invoices",
    requires: [["invoices", "view"]],
  },
  { name: "Items and services", description: "What was sold, how much of it and for how much.", icon: Barcode, href: "/reports/items" },
  { name: "Website requests", description: "Requests that came in through the website.", icon: Globe },
  { name: "Tax", description: "Tax collected, by rate and by period.", icon: Percent, href: "/reports/tax", requires: [["financials", "view"]] },
  {
    name: "Call Tracking",
    description: "Calls by number, source and outcome.",
    icon: Phone,
    href: "/reports/call-tracking",
    requires: [["calls", "view"]],
  },
  { name: "Inventory Usage", description: "Stock used on jobs, by item and by technician.", icon: Archive, href: "/reports/inventory-usage" },
  { name: "Franchise Report", description: "Figures across franchise locations.", icon: Store },
  {
    name: "Commissions (Legacy)",
    description: "Commission earned per technician on done jobs.",
    icon: Calculator,
    href: "/reports/commission",
    requires: [["commission", "view"]],
  },
];
